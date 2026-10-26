import './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { CAPABILITIES, invalidateModelCache } from '@aihot/backend/editorial/models';
import { BudgetExceededError } from '@aihot/backend/providers/receipts';
import { prepareTrial, stopTrial, runTrialTick, TRIAL_KEY, TRIAL_ARTICLES_PER_TICK } from '../industry/v0.1/auto-trial.ts';

after(async () => { await stopBoss(); await closeDb(); });

test('reports precede bounded article batches; budget cooldown survives ticks while free work continues', async () => {
  Object.assign(process.env, { COLLECT_ENABLED: 'false', MODEL_CALLS_ENABLED: 'false', LLM_MODEL: 'deepseek-flash',
    LLM_API_KEY: 'test-not-a-key', LLM_EXTRA_JSON: '{"thinking":{"type":"disabled"}}' });
  for (const capability of Object.values(CAPABILITIES)) process.env[capability.env] = 'default';
  invalidateModelCache();
  const source = 'rss-inspect-ai', ids: string[] = [], order: string[] = [];
  const [beforeBudget] = await sql`SELECT * FROM budgets WHERE service = 'llm'`;
  const [beforeCalls] = await sql`SELECT count(*) AS n FROM receipt_attempts`;
  try {
    await sql`INSERT INTO sources (id, name, kind, tier, next_fetch_at) VALUES (${source}, 'Schedule fixture', 'rss', 'T1', '2099-01-01')`;
    const prepared = await prepareTrial();
    for (let i = 0; i < TRIAL_ARTICLES_PER_TICK + 1; i++) {
      const { articleId } = await upsertMaterial({ sourceId: source, title: 'Agent evaluation', url: `https://example.org/schedule/${Date.now()}/${i}`,
        via: 'import', publishedAt: new Date(Date.now() - 3600000), bodyStatus: 'ok', bodyText: 'Agent evaluation evidence' });
      ids.push(articleId);
      await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
        VALUES (${articleId}, 1, 'rule', 'pass', 'methods', '评测方法', '以最终状态检验任务完成。', 22, false)`;
    }
    let collections = 0, reports = 0, hot = 0;
    const operations = {
      reports: async () => { reports++; order.push('report'); return { generated: [] as string[] }; },
      hot: async () => { hot++; return { id: 0, entries: 0 }; },
      group: async (id: string) => { order.push(id); await sql`UPDATE articles SET grouped_at = now() WHERE id = ${id}`; return { verdict: 'standalone' as const }; },
      collect: async () => { collections++; throw new Error('Free fixture collection'); },
      analyze: async () => { throw new Error('No model call expected'); },
    };
    const first = await runTrialTick({ maintenance: true, operations });
    assert.equal(order[0], 'report');
    assert.equal(first.counts!.grouped, TRIAL_ARTICLES_PER_TICK);
    assert.equal((await runTrialTick({ operations })).counts!.grouped, 1, 'next tick processes the remainder');
    await sql`UPDATE sources SET next_fetch_at = now() - interval '1 minute' WHERE id = ${source}`;
    const now = new Date();
    const limited = await runTrialTick({ now, maintenance: true, operations: { ...operations,
      reports: async () => { reports++; throw new BudgetExceededError('llm', 'hour', 600); } } });
    assert.equal(limited.status, 'budget-waiting');
    assert.ok('reportCheck' in limited && 'modelRetryAt' in limited);
    assert.equal(limited.counts!.analyzed, 0);
    assert.equal(limited.reportCheck.status, 'budget-waiting');
    assert.equal(limited.modelRetryAt, new Date(+now + 600000).toISOString());
    const reportsBefore = reports;
    await runTrialTick({ now: new Date(+now + 60000), maintenance: true, operations });
    assert.equal(reports, reportsBefore, 'cooldown also blocks subsequent report attempts');
    assert.equal(collections, 2, 'free collection still runs during cooldown');
    assert.equal(hot, 3, 'free hot computation still runs during cooldown');
    const resumed = await runTrialTick({ now: new Date(+now + 600001), maintenance: true, operations });
    assert.equal(resumed.status, 'ok');
    assert.ok('modelRetryAt' in resumed);
    assert.equal(resumed.modelRetryAt, null);
    assert.equal(reports, reportsBefore + 1);
    assert.equal((await sql`SELECT value->>'expiresAt' AS at FROM settings WHERE key = ${TRIAL_KEY}`)[0]!.at, prepared.expiresAt);
    assert.equal((await sql`SELECT count(*) AS n FROM receipt_attempts`)[0]!.n, beforeCalls!.n);
    assert.deepEqual((await sql`SELECT per_minute, per_hour, per_day FROM budgets WHERE service='llm'`)[0], { per_minute: 5, per_hour: 30, per_day: 100 });
  } finally {
    await stopTrial();
    await sql`UPDATE budgets SET per_minute=${beforeBudget!.per_minute}, per_hour=${beforeBudget!.per_hour}, per_day=${beforeBudget!.per_day} WHERE service='llm'`;
    await sql`DELETE FROM settings WHERE key IN (${TRIAL_KEY}, ${TRIAL_KEY + '.last-tick'})`;
    if (ids.length) await sql`DELETE FROM articles WHERE id IN ${sql(ids)}`;
    await sql`DELETE FROM sources WHERE id=${source}`;
  }
});
