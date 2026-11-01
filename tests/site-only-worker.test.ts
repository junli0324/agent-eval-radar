import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('site-only worker refuses before connecting even with paid valves enabled', () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../industry/v0.1/site-only-worker.ts', import.meta.url))], {
    encoding: 'utf8', timeout: 5000, env: { ...process.env, COLLECT_ENABLED: 'true', MODEL_CALLS_ENABLED: 'true',
      DATABASE_URL: 'postgres://invalid:invalid@127.0.0.1:1/must_not_connect' },
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.equal(JSON.parse(child.stderr.trim()).status, 'site-only-worker-disabled');
  assert.equal(child.stdout, '');
});
