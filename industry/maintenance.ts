// Admin-only file status. No database, collector, model or queue calls.
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const BACKUP_INTERVAL_MS = 24 * 3600000;
export const BACKUP_RETRY_MS = 3600000;
export const MAINTENANCE_STALE_MS = 10 * 60000;
const time = z.iso.datetime().nullable();
export const MaintenanceStateSchema = z.object({
  version: z.literal(1), checkedAt: z.iso.datetime(),
  website: z.object({ ok: z.boolean(), httpStatus: z.number().int().min(100).max(599).nullable() }),
  backup: z.object({ lastAttemptAt: time, lastSuccessAt: time, lastAttemptOk: z.boolean().nullable(),
    directory: z.string().regex(/^agent-eval-[a-zA-Z0-9_-]+$/).nullable(), dumpBytes: z.number().nonnegative().nullable() }),
});
export type MaintenanceState = z.infer<typeof MaintenanceStateSchema>;
export interface MaintenanceOverview {
  state: 'healthy' | 'degraded' | 'offline' | 'not-started' | 'unavailable';
  checkedAt: string | null; websiteOk: boolean | null;
  lastBackupAt: string | null; backupOk: boolean | null; backupBytes: number | null; nextBackupAt: string | null;
  storage: 'local';
}

export async function readMaintenanceState(file: string): Promise<{ value: MaintenanceState | null; error: 'missing' | 'invalid' | null }> {
  try {
    const raw = await readFile(file, 'utf8');
    if (raw.length > 65536) return { value: null, error: 'invalid' };
    const parsed = MaintenanceStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? { value: parsed.data, error: null } : { value: null, error: 'invalid' };
  } catch (error) {
    return { value: null, error: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid' };
  }
}

export function nextBackupTime(s: MaintenanceState | null, now = Date.now()) {
  if (!s) return now;
  const b = s.backup;
  const at = b.lastAttemptOk === false ? b.lastAttemptAt : b.lastSuccessAt;
  if (!at || Date.parse(at) > now + 5 * 60000) return now;
  return Date.parse(at) + (b.lastAttemptOk === false ? BACKUP_RETRY_MS : BACKUP_INTERVAL_MS);
}

export async function loadMaintenanceOverview(file = process.env.RADAR_MAINTENANCE_STATUS_FILE, now = new Date()): Promise<MaintenanceOverview | null> {
  if (!file) return null;
  const { value: s, error } = await readMaintenanceState(file);
  if (!s) return { state: error === 'missing' ? 'not-started' : 'unavailable', checkedAt: null, websiteOk: null,
    lastBackupAt: null, backupOk: null, backupBytes: null, nextBackupAt: null, storage: 'local' };
  const stale = +now - Date.parse(s.checkedAt) > MAINTENANCE_STALE_MS || Date.parse(s.checkedAt) > +now + 5 * 60000;
  const backupOld = !s.backup.lastSuccessAt || +now - Date.parse(s.backup.lastSuccessAt) > BACKUP_INTERVAL_MS + BACKUP_RETRY_MS
    || Date.parse(s.backup.lastSuccessAt) > +now + 5 * 60000;
  return { state: stale ? 'offline' : !s.website.ok || s.backup.lastAttemptOk === false || backupOld ? 'degraded' : 'healthy',
    checkedAt: s.checkedAt, websiteOk: s.website.ok, lastBackupAt: s.backup.lastSuccessAt,
    backupOk: s.backup.lastAttemptOk, backupBytes: s.backup.dumpBytes, nextBackupAt: new Date(nextBackupTime(s, +now)).toISOString(), storage: 'local' };
}
