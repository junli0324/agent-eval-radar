import './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import { CAPABILITIES, invalidateModelCache } from '@aihot/backend/editorial/models';
import { databaseProof } from '../industry/v0.1/backup-drill.ts';
import { startNextTrial, prepareTrial, stopTrial, TRIAL_KEY, TRIAL_LOCK } from '../industry/v0.1/auto-trial.ts';

after(closeDb);

test('a separately authorized next round cannot extend, reset usage, restore higher budgets or lose the prior audit', async () => {
  process.env.COLLECT_ENABLED = 'false'; process.env.MODEL_CALLS_ENABLED = 'false';
  process.env.LLM_MODEL = 'deepseek-flash'; process.env.LLM_API_KEY = 'test-not-a-real-key';
  process.env.LLM_EXTRA_JSON = '{"thinking":{"type":"disabled"}}';
  for (const c of Object.values(CAPABILITIES)) process.env[c.env] = 'default';
  invalidateModelCache();
  const [originalBudget] = await sql`SELECT per_minute, per_hour, per_day FROM budgets WHERE service = 'llm'`;
  const keys = [TRIAL_KEY, TRIAL_KEY + '.last-tick'];
  const oldSettings = await sql`SELECT key, value FROM settings WHERE key IN ${sql(keys)}`;
  const budget = { per_minute: 5, per_hour: 30, per_day: 100 };
  const expiresAt = '2020-01-04T00:00:00.000Z', now = new Date('2020-01-05T00:00:00.000Z');
  const previous = { version: 1, state: 'active', startedAt: '2020-01-01T00:00:00.000Z', expiresAt,
    budgetBefore: { per_minute: 50, per_hour: 300, per_day: 1000 }, budgetApplied: budget };
  const lastTick = { at: '2020-01-03T23:59:00.000Z', status: 'budget-waiting', modelRetryAt: '2020-01-04T01:00:00.000Z' };
  try {
    await sql`DELETE FROM settings WHERE key IN ${sql(keys)}`;
    await sql`UPDATE budgets SET per_minute=5, per_hour=30, per_day=100 WHERE service='llm'`;
    await sql`INSERT INTO settings (key,value) VALUES (${TRIAL_KEY},${sql.json(previous)}),(${keys[1]!},${sql.json(lastTick)})`;
    await sql`INSERT INTO sources (id,name,kind,tier,next_fetch_at) VALUES ('rss-tau2-bench','Next-round fixture','rss','T1','2099-01-01')`;
    await assert.rejects(startNextTrial('not-a-date', now), /exact previous/);
    await assert.rejects(startNextTrial('2020-01-03T00:00:00.000Z', now), /does not match/);
    await assert.rejects(startNextTrial(expiresAt, new Date('2020-01-02T00:00:00Z')), /has not expired/);
    await assert.rejects(prepareTrial(now), /expired/);
    const held = await sql.reserve();
    try {
      await held`SELECT pg_advisory_lock(hashtext(${TRIAL_LOCK}))`;
      await assert.rejects(startNextTrial(expiresAt, now), /Stop the trial worker/);
    } finally { await held`SELECT pg_advisory_unlock(hashtext(${TRIAL_LOCK}))`; held.release(); }
    await sql`UPDATE budgets SET per_day=99 WHERE service='llm'`;
    await assert.rejects(startNextTrial(expiresAt, now), /budget changed/);
    await sql`UPDATE budgets SET per_day=100 WHERE service='llm'`;
    const proof = await databaseProof();
    const next = await startNextTrial(expiresAt, now);
    assert.equal(next.status, 'prepared-next'); assert.equal(next.modelCalls, 0);
    assert.equal(Date.parse(next.expiresAt) - Date.parse(next.startedAt), 72 * 3600000);
    assert.deepEqual(next.budget, budget);
    const changed = (await databaseProof()).filter((p,i) => p.fingerprint !== proof[i]!.fingerprint).map(p => p.table).sort();
    assert.deepEqual(changed, ['audit_log','settings'], 'no budget, receipt, article, source or queue writes');
    assert.equal((await sql`SELECT count(*)::int AS n FROM settings WHERE key=${keys[1]!}`)[0]!.n, 0);
    const [audit] = await sql`SELECT before,after FROM audit_log WHERE action='trial.next' AND after->>'startedAt'=${now.toISOString()}`;
    assert.deepEqual(audit!.before, { trial: previous, lastTick });
    assert.deepEqual(audit!.after.budgetBefore, budget, 'stop cannot restore the earlier higher budget');
    await assert.rejects(startNextTrial(expiresAt, new Date(+now+1000)), /does not match/);
    assert.equal((await prepareTrial(new Date(+now+1000))).expiresAt, next.expiresAt);
    assert.equal((await stopTrial()).budgetRestored, true);
    assert.deepEqual((await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='llm'`)[0], budget);
  } finally {
    await sql`UPDATE budgets SET per_minute=${originalBudget!.per_minute},per_hour=${originalBudget!.per_hour},per_day=${originalBudget!.per_day} WHERE service='llm'`;
    await sql`DELETE FROM settings WHERE key IN ${sql(keys)}`;
    for (const r of oldSettings) await sql`INSERT INTO settings (key,value) VALUES (${r.key},${sql.json(r.value)})`;
    await sql`DELETE FROM sources WHERE id='rss-tau2-bench'`;
  }
});
