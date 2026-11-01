// Local data backup and read-only verification. Restoration is deliberately a separate, isolated step.
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { config } from '@aihot/backend/config';
import { sql, closeDb, type Db } from '@aihot/backend/db';

const exec = promisify(execFile);
interface TableProof { schema: string; table: string; rows: number; fingerprint: string }
interface FileProof { file: string; bytes: number; sha256: string }
interface Manifest {
  version: 1; createdAt: string; postgresMajor: number;
  dump: FileProof; archive: FileProof; uploads: FileProof[]; tables: TableProof[];
  note: string;
}

function offline() {
  if (process.env.COLLECT_ENABLED !== 'false' || process.env.MODEL_CALLS_ENABLED !== 'false') throw new Error('Backup drill requires both valves=false');
}
async function sha256(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
async function proof(file: string, name = path.basename(file)): Promise<FileProof> {
  return { file: name, bytes: (await lstat(file)).size, sha256: await sha256(file) };
}
function inside(root: string, relative: string) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Invalid backup member path');
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Backup member escapes its directory');
  return target;
}
async function uploads(root: string): Promise<FileProof[]> {
  const out: FileProof[] = [];
  const walk = async (dir: string) => {
    for (const name of (await readdir(dir)).sort()) {
      const file = path.join(dir, name), entry = await lstat(file);
      if (entry.isSymbolicLink()) throw new Error('Upload symlinks require manual review; no archive accepted');
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) out.push(await proof(file, path.relative(root, file).split(path.sep).join('/')));
    }
  };
  const dir = path.join(root, 'uploads');
  const entry = await lstat(dir).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  if (entry?.isSymbolicLink()) throw new Error('Upload directory must not be a symlink');
  if (entry?.isDirectory()) await walk(dir);
  return out;
}

export async function databaseProof(db: Db = sql): Promise<TableProof[]> {
  const tables = await db`SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public','pgboss') ORDER BY schemaname,tablename`;
  const out: TableProof[] = [];
  for (const t of tables) {
    const [p] = await db`SELECT count(*)::int AS rows, md5(coalesce(string_agg(fingerprint,'' ORDER BY fingerprint),'')) AS fingerprint
      FROM (SELECT md5(to_jsonb(row_data)::text) AS fingerprint FROM ${db(t.schemaname)}.${db(t.tablename)} row_data) hashed`;
    out.push({ schema: t.schemaname, table: t.tablename, rows: p!.rows, fingerprint: p!.fingerprint });
  }
  return out;
}

export async function createLocalBackup(parent: string, dataDir = config.dataDir) {
  offline();
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(path.resolve(parent), 'agent-eval-'));
  const dump = path.join(dir, 'database.dump'), archive = path.join(dir, 'uploads.tar.gz');
  // Keep the password out of child-process arguments and all diagnostic output.
  const database = new URL(config.databaseUrl), password = decodeURIComponent(database.password);
  database.password = '';
  let manifest: Manifest;
  try {
    manifest = await sql.begin('isolation level repeatable read read only', async tx => {
      const [snapshot] = await tx`SELECT pg_export_snapshot() AS id, current_setting('server_version_num')::int / 10000 AS major`;
      const tables = await databaseProof(tx);
      await exec('pg_dump', ['--format=custom', '--compress=6', '--no-owner', '--no-acl', '--snapshot', snapshot!.id, '--file', dump, '--dbname', database.toString()],
        { env: { ...process.env, PGPASSWORD: password }, maxBuffer: 1024 * 1024, timeout: 120000 });
      await exec('pg_restore', ['--list', dump], { maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
      const beforeFiles = await uploads(dataDir);
      const hasUploads = await lstat(path.join(dataDir, 'uploads')).then(s => s.isDirectory(), () => false);
      await exec('tar', hasUploads ? ['-czf', archive, '-C', dataDir, 'uploads'] : ['-czf', archive, '-T', '/dev/null'], { timeout: 120000 });
      if (JSON.stringify(beforeFiles) !== JSON.stringify(await uploads(dataDir))) throw new Error('Uploads changed during backup');
      return { version: 1 as const, createdAt: new Date().toISOString(), postgresMajor: snapshot!.major,
        dump: await proof(dump), archive: await proof(archive), uploads: beforeFiles, tables,
        note: 'Local data only. No .env, secrets files, transient feedback screenshots or regenerable caches. No retention deletion or cloud upload. Table fingerprints use the same exported database snapshot as pg_dump.' };
    }) as Manifest;
  } catch {
    throw new Error('Local backup incomplete; source unchanged. Keep this directory for local diagnosis and retry into a new directory.');
  }
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  return { directory: dir, tables: manifest.tables.length, uploadFiles: manifest.uploads.length, dumpBytes: manifest.dump.bytes, modelCalls: 0, sourceWrites: 0 };
}

export async function verifyRestoredBackup(manifestPath: string, restoredFilesDir: string) {
  offline();
  const database = new URL(config.databaseUrl).pathname.slice(1);
  if (process.env.AGENT_EVAL_RESTORE_DRILL !== 'true' || !/_(test|ci)$/.test(database)) throw new Error('Verify requires AGENT_EVAL_RESTORE_DRILL=true and a separate *_test or *_ci database');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.tables) || !Array.isArray(manifest.uploads)) throw new Error('Invalid backup manifest');
  const dir = path.dirname(path.resolve(manifestPath));
  for (const file of [manifest.dump, manifest.archive]) {
    const actual = await proof(inside(dir, file.file), file.file);
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw new Error('Backup file checksum mismatch');
  }
  const [version] = await sql`SELECT current_setting('server_version_num')::int / 10000 AS major`;
  if (version!.major !== manifest.postgresMajor) throw new Error('Use the same PostgreSQL major version for the drill');
  const actual = await sql.begin('isolation level repeatable read read only', tx => databaseProof(tx)) as TableProof[];
  const expected = new Map(manifest.tables.map(t => [`${t.schema}.${t.table}`, t]));
  const mismatches = actual.filter(t => { const e = expected.get(`${t.schema}.${t.table}`); return !e || e.rows !== t.rows || e.fingerprint !== t.fingerprint; })
    .map(t => `${t.schema}.${t.table}`);
  for (const t of manifest.tables) if (!actual.some(a => a.schema === t.schema && a.table === t.table)) mismatches.push(`${t.schema}.${t.table}`);
  if (mismatches.length) throw new Error(`Restored table mismatch: ${mismatches.join(', ')}`);
  if (JSON.stringify(manifest.uploads) !== JSON.stringify(await uploads(restoredFilesDir))) throw new Error('Restored uploads mismatch');
  return { verified: true, tables: actual.length, uploadFiles: manifest.uploads.length,
    keyTables: actual.filter(t => t.schema === 'public' && ['articles','publications','reports','sources','editorial_overrides','receipts','settings','budgets'].includes(t.table))
      .map(({ table, rows }) => ({ table, rows })), modelCalls: 0, writes: 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [command, first, second, ...extra] = process.argv.slice(2);
    if (extra.length || (command === 'backup' ? !first?.startsWith('--dir=') || second !== undefined
      : command === 'verify' ? !first?.startsWith('--manifest=') || !second?.startsWith('--files-dir=') : true)) {
      throw new Error('Use backup --dir=PATH or verify --manifest=PATH --files-dir=PATH');
    }
    console.log(JSON.stringify(command === 'backup' ? await createLocalBackup(first!.slice(6)) : await verifyRestoredBackup(first!.slice(11), second!.slice(12)), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Backup drill failed'); process.exitCode = 1; }
  finally { await closeDb(); }
}
