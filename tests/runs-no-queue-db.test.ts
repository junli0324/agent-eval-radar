import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import { runsOverview } from '@aihot/backend/admin/runs';

after(closeDb);

test('admin diagnosis reads a fresh site without creating or requiring the content queue schema', async () => {
  const saved = `pgboss_saved_${tag()}`;
  const [schema] = await sql`SELECT to_regnamespace('pgboss') IS NOT NULL AS present`;
  if (schema!.present) await sql`ALTER SCHEMA pgboss RENAME TO ${sql(saved)}`;
  try {
    const [before] = await sql`SELECT count(*) AS n FROM receipt_attempts`;
    const result = await runsOverview();
    assert.deepEqual(result.queues, []); assert.deepEqual(result.failedJobs, []);
    assert.equal((await sql`SELECT to_regclass('pgboss.job') IS NULL AS absent`)[0]!.absent, true);
    assert.equal((await sql`SELECT count(*) AS n FROM receipt_attempts`)[0]!.n, before!.n);
  } finally {
    if (schema!.present) await sql`ALTER SCHEMA ${sql(saved)} RENAME TO pgboss`;
  }
});
