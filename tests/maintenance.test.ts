import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import http from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeDb } from '@aihot/backend/db';
import { maintenanceTick } from '../industry/v0.1/maintenance.ts';
import { loadMaintenanceOverview, nextBackupTime, readMaintenanceState, BACKUP_INTERVAL_MS, BACKUP_RETRY_MS } from '../industry/maintenance.ts';

after(closeDb);

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'radar-maintenance-test-'));
  const server = http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, db: 'ok' })));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const opts = { outputDir: dir, statusFile: path.join(dir, 'state.json'), healthUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/api/health` };
  return { dir, server, opts, close: async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep + 'radar-maintenance-test-'));
    await rm(dir, { recursive: true, force: true });
  } };
}

test('local maintenance persists its cadence, skips duplicate backups and marks stale status without model calls', async () => {
  process.env.COLLECT_ENABLED = 'false'; process.env.MODEL_CALLS_ENABLED = 'false';
  const f = await fixture(), now = new Date('2020-01-01T00:00:00Z'); let calls = 0;
  const backup = async () => { calls++; return { directory: path.join(f.dir, 'agent-eval-fixture'), dumpBytes: 4096 }; };
  try {
    const first = await maintenanceTick({ ...f.opts, now, backup });
    assert.equal(calls, 1); assert.equal(first.modelCalls, 0); assert.equal(first.databaseWrites, 0);
    assert.deepEqual(first.events.map(e => e.event), ['site-health-changed','local-backup-completed']);
    assert.equal((await loadMaintenanceOverview(f.opts.statusFile, now))!.state, 'healthy');
    const later = new Date(+now + 300000);
    assert.equal((await maintenanceTick({ ...f.opts, now: later, backup })).events.length, 0);
    assert.equal(calls, 1, 'another process reads the persisted timestamp instead of making a second backup');
    assert.equal(nextBackupTime((await readMaintenanceState(f.opts.statusFile)).value, +later), +now + BACKUP_INTERVAL_MS);
    assert.equal((await loadMaintenanceOverview(f.opts.statusFile, new Date(+later + 660000)))!.state, 'offline');
    await maintenanceTick({ ...f.opts, now: new Date(+now + BACKUP_INTERVAL_MS), backup });
    assert.equal(calls, 2);
    process.env.MODEL_CALLS_ENABLED = 'true';
    await assert.rejects(maintenanceTick({ ...f.opts, backup }), /both valves=false/);
    assert.equal(calls, 2);
  } finally { process.env.MODEL_CALLS_ENABLED = 'false'; await f.close(); }
});

test('failed backups back off, health and privacy remain separate, and corrupt status does not delete backups', async () => {
  process.env.COLLECT_ENABLED = 'false'; process.env.MODEL_CALLS_ENABLED = 'false';
  const f = await fixture(), now = new Date('2020-02-01T00:00:00Z'); let calls = 0;
  const failed = async () => { calls++; throw new Error('DO_NOT_EXPOSE_SENTINEL'); };
  try {
    const result = await maintenanceTick({ ...f.opts, now, backup: failed });
    assert.equal(result.state.website.ok, true); assert.equal(result.state.backup.lastAttemptOk, false);
    assert.equal((await loadMaintenanceOverview(f.opts.statusFile, now))!.state, 'degraded');
    assert.equal(nextBackupTime(result.state, +now), +now + BACKUP_RETRY_MS);
    await maintenanceTick({ ...f.opts, now: new Date(+now + 300000), backup: failed });
    assert.equal(calls, 1);
    assert.doesNotMatch(await readFile(f.opts.statusFile, 'utf8'), /DO_NOT_EXPOSE/);
    assert.doesNotMatch(JSON.stringify(result.events), /DO_NOT_EXPOSE/);
    await writeFile(path.join(f.dir, 'existing-backup.keep'), 'preserve');
    await writeFile(f.opts.statusFile, 'corrupt state');
    assert.equal((await loadMaintenanceOverview(f.opts.statusFile, now))!.state, 'unavailable');
    f.server.removeAllListeners('request');
    f.server.on('request', (_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"db":"failed"}'));
    await maintenanceTick({ ...f.opts, now, backup: async () => ({ directory: path.join(f.dir, 'agent-eval-recovered'), dumpBytes: 2048 }) });
    const status = await loadMaintenanceOverview(f.opts.statusFile, now);
    assert.equal(status!.websiteOk, false); assert.equal(status!.backupOk, true); assert.equal(status!.state, 'degraded');
    assert.equal(await readFile(path.join(f.dir, 'existing-backup.keep'), 'utf8'), 'preserve');
  } finally { await f.close(); }
});

test('maintenance status is optional and unavailable files never masquerade as a successful backup', async () => {
  const f = await fixture();
  try {
    const old = process.env.RADAR_MAINTENANCE_STATUS_FILE; delete process.env.RADAR_MAINTENANCE_STATUS_FILE;
    try { assert.equal(await loadMaintenanceOverview(), null); }
    finally { if (old !== undefined) process.env.RADAR_MAINTENANCE_STATUS_FILE = old; }
    assert.equal((await loadMaintenanceOverview(f.opts.statusFile))!.state, 'not-started');
    await writeFile(f.opts.statusFile, JSON.stringify({ password: 'DO_NOT_EXPOSE_SENTINEL' }));
    const overview = await loadMaintenanceOverview(f.opts.statusFile);
    assert.equal(overview!.state, 'unavailable'); assert.equal(overview!.lastBackupAt, null);
    assert.doesNotMatch(JSON.stringify(overview), /DO_NOT_EXPOSE/);
  } finally { await f.close(); }
});
