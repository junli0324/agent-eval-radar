// A standalone local maintainer: health reads and snapshot backups, never the content worker.
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { sql, closeDb } from '@aihot/backend/db';
import { createLocalBackup } from './backup-drill.ts';
import { readMaintenanceState, nextBackupTime, loadMaintenanceOverview, MaintenanceStateSchema, type MaintenanceState } from '../maintenance.ts';

type BackupResult = { directory: string; dumpBytes: number };
interface Options {
  outputDir: string; statusFile: string; healthUrl: string; now?: Date;
  backup?: () => Promise<BackupResult>;
}

function offline() {
  if (process.env.COLLECT_ENABLED !== 'false' || process.env.MODEL_CALLS_ENABLED !== 'false') throw new Error('Maintenance requires both valves=false');
}

export async function maintenanceTick(opts: Options) {
  offline();
  const now = opts.now ?? new Date();
  const url = new URL(opts.healthUrl);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP health endpoint without credentials');
  const { value: before } = await readMaintenanceState(opts.statusFile);
  let website: MaintenanceState['website'] = { ok: false, httpStatus: null };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error', cache: 'no-store' });
    website.httpStatus = res.status;
    const body = await res.json() as { ok?: boolean; db?: string };
    website.ok = res.ok && body.ok === true && body.db === 'ok';
  } catch { /* Network and response details stay out of status files and logs. */ }
  const state: MaintenanceState = { version: 1, checkedAt: now.toISOString(), website,
    backup: before?.backup ?? { lastAttemptAt: null, lastSuccessAt: null, lastAttemptOk: null, directory: null, dumpBytes: null } };
  const events: Array<Record<string, unknown>> = [];
  if (!before || before.website.ok !== website.ok) events.push({ event: 'site-health-changed', at: state.checkedAt, ...website });
  if (nextBackupTime(before, +now) <= +now) {
    state.backup = { ...state.backup, lastAttemptAt: now.toISOString() };
    try {
      const result = await (opts.backup ?? (() => createLocalBackup(opts.outputDir)))();
      state.backup = { lastAttemptAt: now.toISOString(), lastAttemptOk: true, lastSuccessAt: now.toISOString(),
        directory: path.basename(result.directory), dumpBytes: result.dumpBytes };
      events.push({ event: 'local-backup-completed', at: now.toISOString(), dumpBytes: result.dumpBytes });
    } catch (error) {
      state.backup.lastAttemptOk = false;
      const code = (error as NodeJS.ErrnoException).code;
      events.push({ event: 'local-backup-failed', at: now.toISOString(), code: typeof code === 'string' && /^[A-Z0-9_]{1,24}$/.test(code) ? code : 'local-backup-error',
        nextRetryAt: new Date(nextBackupTime(state, +now)).toISOString() });
    }
  }
  MaintenanceStateSchema.parse(state);
  await mkdir(path.dirname(opts.statusFile), { recursive: true });
  const temp = path.join(path.dirname(opts.statusFile), `.maintenance-${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
  await rename(temp, opts.statusFile);
  return { state, events, modelCalls: 0, databaseWrites: 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => controller.abort());
  let connection: Awaited<ReturnType<typeof sql.reserve>> | undefined;
  try {
    offline();
    const [command, flag, ...extra] = process.argv.slice(2);
    if (extra.length || !['run','once','status'].includes(command ?? '') || (flag && (command !== 'status' || flag !== '--require-healthy'))) {
      throw new Error('Use run, once, or status [--require-healthy]');
    }
    const statusFile = process.env.RADAR_MAINTENANCE_STATUS_FILE || '/maintenance-state/state.json';
    if (command === 'status') {
      const overview = await loadMaintenanceOverview(statusFile);
      console.log(JSON.stringify(overview));
      if (flag && overview?.state !== 'healthy') process.exitCode = 1;
    } else {
      connection = await sql.reserve();
      const [lock] = await connection`SELECT pg_try_advisory_lock(hashtext('agent-eval.local-maintenance')) AS locked, pg_backend_pid() AS pid`;
      if (!lock?.locked) throw new Error('Another local maintainer is running');
      do {
        const [session] = await connection`SELECT pg_backend_pid() AS pid`;
        if (session?.pid !== lock.pid) throw new Error('Maintenance database session changed; restart to reacquire its lock');
        const result = await maintenanceTick({ statusFile, outputDir: process.env.RADAR_BACKUP_OUTPUT || '/backups',
          healthUrl: process.env.RADAR_HEALTH_URL || 'http://web:3000/api/health' });
        for (const event of result.events) console.log(JSON.stringify(event));
        if (command === 'once') {
          if ((await loadMaintenanceOverview(statusFile))?.state !== 'healthy') process.exitCode = 1;
          break;
        }
        await delay(result.state.website.ok ? 300000 : 30000, undefined, { signal: controller.signal }).catch(() => {});
      } while (!controller.signal.aborted);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    console.error(JSON.stringify({ event: 'maintenance-stopped', code: typeof code === 'string' && /^[A-Z0-9_]{1,24}$/.test(code) ? code : 'maintenance-error',
      reason: 'Check database access, disabled valves, local mount permissions and the maintainer instance count.' })); process.exitCode = 1;
  }
  finally { connection?.release(); await closeDb(); }
}
