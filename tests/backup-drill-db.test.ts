import './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sql, closeDb } from '@aihot/backend/db';
import { databaseProof, verifyRestoredBackup, createLocalBackup } from '../industry/v0.1/backup-drill.ts';

after(closeDb);

test('restore verification detects table changes, missing tables, file tampering and extra uploads without writing data', async () => {
  process.env.COLLECT_ENABLED = 'false'; process.env.MODEL_CALLS_ENABLED = 'false';
  const dir = await mkdtemp(path.join(tmpdir(), 'radar-backup-test-'));
  const files = path.join(dir, 'restored-files');
  const manifestPath = path.join(dir, 'manifest.json');
  const fileProof = (file: string, body: string) => ({ file, bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') });
  try {
    await mkdir(path.join(files, 'uploads'), { recursive: true });
    await writeFile(path.join(files, 'uploads', 'fixture.txt'), 'upload evidence');
    await writeFile(path.join(dir, 'database.dump'), 'checksum fixture');
    await writeFile(path.join(dir, 'uploads.tar.gz'), 'archive checksum fixture');
    await sql`CREATE TABLE public.backup_drill_fixture (id int PRIMARY KEY, evidence text)`;
    await sql`INSERT INTO public.backup_drill_fixture VALUES (1,'preserve manual evidence')`;
    const [version] = await sql`SELECT current_setting('server_version_num')::int / 10000 AS major`;
    const manifest = { version: 1, postgresMajor: version!.major, tables: await databaseProof(),
      dump: fileProof('database.dump', 'checksum fixture'), archive: fileProof('uploads.tar.gz', 'archive checksum fixture'),
      uploads: [fileProof('uploads/fixture.txt', 'upload evidence')] };
    await writeFile(manifestPath, JSON.stringify(manifest));
    delete process.env.AGENT_EVAL_RESTORE_DRILL;
    await assert.rejects(verifyRestoredBackup(manifestPath, files), /separate.*database/);
    process.env.AGENT_EVAL_RESTORE_DRILL = 'true';
    const [calls] = await sql`SELECT count(*) AS n FROM receipt_attempts`;
    assert.equal((await verifyRestoredBackup(manifestPath, files)).verified, true);
    assert.equal((await sql`SELECT count(*) AS n FROM receipt_attempts`)[0]!.n, calls!.n);
    await sql`UPDATE public.backup_drill_fixture SET evidence='changed' WHERE id=1`;
    await assert.rejects(verifyRestoredBackup(manifestPath, files), /table mismatch.*backup_drill_fixture/);
    await sql`UPDATE public.backup_drill_fixture SET evidence='preserve manual evidence' WHERE id=1`;
    await writeFile(path.join(dir, 'database.dump'), 'damaged');
    await assert.rejects(verifyRestoredBackup(manifestPath, files), /checksum mismatch/);
    await writeFile(path.join(dir, 'database.dump'), 'checksum fixture');
    await writeFile(path.join(files, 'uploads', 'unexpected.txt'), 'extra');
    await assert.rejects(verifyRestoredBackup(manifestPath, files), /uploads mismatch/);
    await rm(path.join(files, 'uploads', 'unexpected.txt'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, dump: { ...manifest.dump, file: '../database.dump' } }));
    await assert.rejects(verifyRestoredBackup(manifestPath, files), /Invalid backup member path/);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await sql`DROP TABLE public.backup_drill_fixture`;
    await assert.rejects(verifyRestoredBackup(manifestPath, files), /table mismatch.*backup_drill_fixture/);
    process.env.MODEL_CALLS_ENABLED = 'true';
    await assert.rejects(createLocalBackup(path.join(dir, 'not-created')), /both valves=false/);
  } finally {
    process.env.MODEL_CALLS_ENABLED = 'false'; delete process.env.AGENT_EVAL_RESTORE_DRILL;
    await sql`DROP TABLE IF EXISTS public.backup_drill_fixture`;
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep + 'radar-backup-test-'));
    await rm(dir, { recursive: true, force: true });
  }
});
