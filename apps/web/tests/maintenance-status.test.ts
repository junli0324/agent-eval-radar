import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import type { MaintenanceOverview } from '@aihot/industry/maintenance';

test('maintenance panel separates site health, local backup, stale status and missing records without action buttons', async () => {
  const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: false } });
  try {
    const { MaintenanceStatus } = await vite.ssrLoadModule('/app/features/admin/MaintenanceStatus.tsx');
    const value: MaintenanceOverview = { state: 'healthy', checkedAt: '2020-01-01T00:00:00Z', websiteOk: true,
      lastBackupAt: '2020-01-01T00:00:00Z', backupOk: true, backupBytes: 2097152, nextBackupAt: '2020-01-02T00:00:00Z', storage: 'local' };
    const render = (v: MaintenanceOverview) => renderToStaticMarkup(createElement(MaintenanceStatus, { value: v }));
    const html = render(value);
    assert.match(html, /运行正常/); assert.match(html, /2.0 MB/); assert.match(html, /尚未接入异地存储/);
    assert.match(html, /独立于内容 worker/); assert.doesNotMatch(html, /<button/);
    assert.match(render({ ...value, state: 'offline' }), /维护服务离线/);
    assert.match(render({ ...value, state: 'degraded', backupOk: false }), /失败，等待重试/);
    const missing = render({ ...value, state: 'not-started', lastBackupAt: null, backupOk: null, backupBytes: null });
    assert.match(missing, /暂无成功备份/); assert.doesNotMatch(missing, /已有本地副本/);
  } finally { await vite.close(); }
});
