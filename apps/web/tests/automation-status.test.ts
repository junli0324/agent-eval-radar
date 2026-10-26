import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import type { AutomationOverview } from '@aihot/industry/automation';

test('automation panel explains expiry, shared-budget waiting and an unexpected worker without action buttons', async () => {
  const vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: false } });
  try {
    const { AutomationStatus } = await vite.ssrLoadModule('/app/features/admin/AutomationStatus.tsx');
    const value: AutomationOverview = { state: 'expired', startedAt: '2020-01-01T00:00:00Z', expiresAt: '2020-01-04T00:00:00Z',
      retryAt: null, lastTickAt: null, lastCollectedAt: null, lastPublicAt: null, lastRequestAt: null,
      budget: { per_minute: 5, per_hour: 30, per_day: 100 }, requests24h: 0, unknownCostAttempts: 163,
      pipeline: { recent_candidates: 93, ready_for_analysis: 53, waiting_for_body: 2, selected_released: 18, ordinary_public: 13 },
      missingSources: 0, daily: { key: '2020-01-04', state: 'no-materials', candidates: 0, checkedAt: null } };
    const render = (data: AutomationOverview) => renderToStaticMarkup(createElement(AutomationStatus, { value: data }));
    const expired = render(value);
    assert.match(expired, /授权已到期/); assert.doesNotMatch(expired, /异常离线/);
    assert.match(expired, /暂无合格材料/); assert.match(expired, /费用尚未记录/);
    assert.match(expired, /下方普通队列由另一入口消费/); assert.doesNotMatch(expired, /<button/);
    const waiting = render({ ...value, state: 'budget-waiting', retryAt: '2020-01-03T12:00:00Z',
      daily: { ...value.daily, state: 'budget-waiting', candidates: 2 } });
    assert.match(waiting, /等待额度恢复/); assert.match(waiting, /等待共享额度/); assert.match(waiting, /额度下次检查/);
    assert.match(render({ ...value, state: 'unexpected-worker' }), /试运行到期保护不代表普通 worker 已停止/);
    assert.match(render({ ...value, state: 'budget-changed' }), /当前预算与授权快照不一致/);
  } finally { await vite.close(); }
});
