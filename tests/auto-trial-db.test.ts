import './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sql, closeDb } from '@aihot/backend/db';
import { queueProcessing } from '@aihot/backend/jobs/content';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { publishArticle } from '@aihot/backend/publication/publish';
import { CAPABILITIES, invalidateModelCache } from '@aihot/backend/editorial/models';
import { BudgetExceededError } from '@aihot/backend/providers/receipts';
import { prepareTrial, stopTrial, runTrialTick, TRIAL_KEY, TRIAL_LOCK, trialStatus, trialActive } from '../industry/v0.1/auto-trial.ts';

after(async () => { await stopBoss(); await closeDb(); });

test('bounded automation preserves history and queued work, expires, shares the model budget and restores it safely', async () => {
  process.env.COLLECT_ENABLED = 'false'; process.env.MODEL_CALLS_ENABLED = 'false';
  process.env.LLM_MODEL = 'deepseek-flash'; process.env.LLM_API_KEY = 'test-not-a-real-key';
  process.env.LLM_EXTRA_JSON = '{"thinking":{"type":"disabled"}}';
  for (const c of Object.values(CAPABILITIES)) process.env[c.env] = 'default';
  invalidateModelCache();
  const [beforeBudget] = await sql`SELECT per_minute, per_hour, per_day FROM budgets WHERE service = 'llm'`;
  const [beforeCalls] = await sql`SELECT count(*) AS n FROM receipt_attempts`;
  const source = 'web-langchain-blog'; const other = `outside-trial-${Date.now()}`;
  const ids: string[] = [];
  const settled: string[] = [];
  try {
    await sql`INSERT INTO sources (id, name, kind, tier, next_fetch_at) VALUES
      (${source}, 'Trial fixture', 'web_list', 'T1_5', '2099-01-01'), (${other}, 'Outside fixture', 'rss', 'T1_5', now())`;
    await sql`INSERT INTO sources (id, name, kind, tier, enabled) VALUES ('rss-tau2-bench', 'Paused fixture', 'rss', 'T1', false)`;
    const first = await prepareTrial();
    assert.equal(first.status, 'prepared');
    const status = await trialStatus();
    assert.equal(status.budget!.per_day, Math.min(beforeBudget!.per_day, 100));
    assert.equal(status.trial!.active, true);
    assert.equal(Date.parse(status.trial!.expiresAt) - Date.parse(status.trial!.startedAt), 72 * 3600000);
    assert.equal((await prepareTrial()).expiresAt, status.trial!.expiresAt, 'repeat prepare cannot extend the trial');

    const held = await sql.reserve();
    try {
      await held`SELECT pg_advisory_lock(hashtext(${TRIAL_LOCK}))`;
      await assert.rejects(stopTrial(), /stop worker/);
    } finally { await held`SELECT pg_advisory_unlock(hashtext(${TRIAL_LOCK}))`; held.release(); }

    for (const kind of ['live', 'archive', 'outside', 'bodyless', 'future', 'undated', 'paused']) {
      const at = kind === 'future' ? new Date(Date.now() + 86400000) : new Date(Date.now() - 3600000);
      const { articleId } = await upsertMaterial({ sourceId: kind === 'outside' ? other : kind === 'paused' ? 'rss-tau2-bench' : source, title: 'Agent evaluation fixture',
        url: `https://example.org/${other}/${kind}`, publishedAt: kind === 'undated' ? null : at, via: 'import',
        bodyText: kind === 'bodyless' ? undefined : 'Original agent evaluation evidence', bodyStatus: kind === 'bodyless' ? 'pending' : 'ok',
        backfill: kind === 'archive' ? 'test-history' : null });
      ids.push(articleId);
      if (!['bodyless', 'archive'].includes(kind)) await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, tags, score, selected)
        VALUES (${articleId}, 1, 'rule', 'pass', 'methods', 'Agent 评测方法', '以最终状态验证任务完成。', ARRAY['评测方法'], 22, false)`;
    }
    await queueProcessing(ids[1]!, { step: 'analyze' });
    const [historyJob] = await sql`SELECT id, state FROM pgboss.job WHERE data->>'articleId' = ${ids[1]!} LIMIT 1`;
    assert.ok(historyJob);
    const grouped: string[] = []; const extracted: string[] = [];
    // Thirty newer, completed items must not keep an older pending item below every tick's limit.
    for (let i = 0; i < 30; i++) {
      const { articleId } = await upsertMaterial({ sourceId: source, title: 'Settled agent evaluation', url: `https://example.org/${other}/settled/${i}`,
        publishedAt: new Date(Date.now() - 600000), via: 'import', bodyText: 'Original evidence', bodyStatus: 'ok' });
      settled.push(articleId);
      await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
        VALUES (${articleId}, 1, 'rule', 'pass', 'methods', '已有评测方法', '已有摘要。', 22, false)`;
      await publishArticle(articleId);
      await sql`UPDATE articles SET grouped_at = now() WHERE id = ${articleId}`;
    }
    const operations = {
      collect: async () => { throw new Error('No source is due'); },
      extract: async (id: string) => { extracted.push(id); throw new Error('Body unavailable'); },
      analyze: async () => { throw new Error('No model request expected'); },
      group: async (id: string) => { grouped.push(id); await sql`UPDATE articles SET grouped_at = now() WHERE id = ${id}`; return { verdict: 'standalone' as const }; },
    };
    const tick = await runTrialTick({ operations });
    assert.equal(tick.status, 'ok'); assert.deepEqual(grouped, [ids[0]]); assert.deepEqual(extracted, [ids[3]]);
    assert.deepEqual((await sql`SELECT article_id FROM publications WHERE article_id IN ${sql(ids)}`).map(r => r.article_id), [ids[0]]);
    assert.equal((await sql`SELECT state FROM pgboss.job WHERE id = ${historyJob!.id}`)[0]!.state, historyJob!.state, 'historical job remains untouched');
    await runTrialTick({ operations }); assert.equal(grouped.length, 1, 'a grouped item is not grouped again');
    await sql`UPDATE articles SET body_status = 'ok', body_text = 'Confirmed body', processing_retry_at = NULL WHERE id = ${ids[3]!}`;
    let attempts = 0;
    await runTrialTick({ operations: { ...operations, analyze: async () => { attempts++; throw new BudgetExceededError('llm', 'day', 3600); } } });
    assert.equal(attempts, 1);
    assert.equal((await runTrialTick({ now: new Date(Date.parse(status.trial!.expiresAt) + 1), operations })).status, 'inactive');
    assert.equal(trialActive(undefined), false);
    const [afterCalls] = await sql`SELECT count(*) AS n FROM receipt_attempts`;
    assert.equal(afterCalls!.n, beforeCalls!.n, 'fixtures never call an external model');
    assert.equal((await stopTrial()).budgetRestored, true);
    assert.deepEqual((await sql`SELECT per_minute, per_hour, per_day FROM budgets WHERE service = 'llm'`)[0], beforeBudget);
    assert.equal((await stopTrial()).status, 'already-stopped');
    const exited = await promisify(execFile)(process.execPath, ['industry/v0.1/auto-trial-worker.ts'], {
      timeout: 15000, env: { ...process.env, AGENT_EVAL_AUTO_TRIAL: 'true', COLLECT_ENABLED: 'true', MODEL_CALLS_ENABLED: 'true', EMBEDDINGS_ENABLED: 'false' },
    });
    assert.match(exited.stdout, /trial-ended/, 'the actual worker entry exits normally without a live trial or paid work');
    await prepareTrial();
    await sql`UPDATE budgets SET per_day = per_day - 1 WHERE service = 'llm'`;
    await assert.rejects(runTrialTick({ operations }), /budget changed/);
    assert.equal((await stopTrial()).budgetRestored, false, 'do not overwrite an intervening manual budget edit');
  } finally {
    await sql`UPDATE budgets SET per_minute = ${beforeBudget!.per_minute}, per_hour = ${beforeBudget!.per_hour}, per_day = ${beforeBudget!.per_day} WHERE service = 'llm'`;
    await sql`DELETE FROM settings WHERE key IN (${TRIAL_KEY}, ${TRIAL_KEY + '.last-tick'})`;
    if (ids.length) { await sql`DELETE FROM pgboss.job WHERE data->>'articleId' IN ${sql(ids)}`; await sql`DELETE FROM articles WHERE id IN ${sql(ids)}`; }
    if (settled.length) { await sql`DELETE FROM pgboss.job WHERE data->>'articleId' IN ${sql(settled)}`; await sql`DELETE FROM articles WHERE id IN ${sql(settled)}`; }
    await sql`DELETE FROM sources WHERE id IN (${source}, ${other}, 'rss-tau2-bench')`;
  }
});
