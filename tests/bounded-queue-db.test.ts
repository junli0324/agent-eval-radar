import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sql, closeDb } from '@aihot/backend/db';
import { getBoss, stopBoss } from '@aihot/backend/jobs/queue';

after(async () => { await stopBoss(); await closeDb(); });

test('bounded queue connections enqueue without deleting expired history or replaying persisted cron schedules', async () => {
  process.env.AGENT_EVAL_AUTO_TRIAL = 'true';
  const b = await getBoss(), name = `bounded-history-${tag()}`;
  await b.createQueue(name);
  const id = await b.send(name, { historical: true });
  await b.schedule(name, '* * * * *', { cron: true });
  await sql`UPDATE pgboss.job SET keep_until=now()-interval '1 day' WHERE id=${id}`;
  await sql`UPDATE pgboss.queue SET maintain_on=now()-interval '1 day' WHERE name=${name}`;
  const [before] = await sql`SELECT to_jsonb(j) AS value FROM pgboss.job j WHERE id=${id}`;
  const [schedule] = await sql`SELECT to_jsonb(s) AS value FROM pgboss.schedule s WHERE name=${name}`;
  await stopBoss();
  try {
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      const {getBoss,stopBoss}=await import('@aihot/backend/jobs/queue');
      const {closeDb}=await import('@aihot/backend/db');
      try {const b=await getBoss(); await b.send(${JSON.stringify(name)},{fresh:true}); await new Promise(r=>setTimeout(r,2200));}
      finally {await stopBoss(); await closeDb();}`], { env: { ...process.env, AGENT_EVAL_AUTO_TRIAL: 'true' }, timeout: 15000 });
    assert.deepEqual((await sql`SELECT to_jsonb(j) AS value FROM pgboss.job j WHERE id=${id}`)[0]?.value, before!.value);
    assert.deepEqual((await sql`SELECT to_jsonb(s) AS value FROM pgboss.schedule s WHERE name=${name}`)[0]?.value, schedule!.value);
    const jobs=await sql`SELECT data FROM pgboss.job WHERE name=${name}`;
    assert.equal(jobs.length,2); assert.equal(jobs.filter(j=>j.data.fresh).length,1);
    assert.equal(jobs.filter(j=>j.data.cron).length,0);
  } finally {
    await sql`DELETE FROM pgboss.schedule WHERE name=${name}`;
    await sql`DELETE FROM pgboss.job WHERE name=${name}`;
    await sql`DELETE FROM pgboss.queue WHERE name=${name}`;
    delete process.env.AGENT_EVAL_AUTO_TRIAL;
  }
});
