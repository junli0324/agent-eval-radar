import './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { publishArticle } from '@aihot/backend/publication/publish';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { loadAutomationOverview } from '@aihot/industry/automation';
import { previewSummaryReplay } from '../industry/v0.1/summary-replay.ts';
import { buildApp } from '../apps/api/src/app.ts';

after(async () => { await stopBoss(); await closeDb(); });

test('admin overview distinguishes normal expiry, cooldown, wrong entry and failures without paid work or mutations', async () => {
  process.env.COLLECT_ENABLED = 'false'; process.env.MODEL_CALLS_ENABLED = 'false';
  const now = new Date('2020-01-02T02:00:00Z'), at = new Date('2020-01-01T10:00:00Z');
  const keys = ['agent-eval.auto-trial', 'agent-eval.auto-trial.last-tick', 'heartbeat.worker'];
  const old = await sql`SELECT * FROM settings WHERE key IN ${sql(keys)}`;
  const [budget] = await sql`SELECT per_minute,per_hour,per_day FROM budgets WHERE service='llm'`;
  const trial = { version: 1, state: 'active', startedAt: '2020-01-01T00:00:00Z', expiresAt: '2020-01-04T00:00:00Z', budgetApplied: budget };
  let articleId: string | undefined, receiptId: number | undefined;
  const app = await buildApp();
  const set = async (key: string, value: Record<string, any>) => sql`INSERT INTO settings (key,value,updated_at) VALUES (${key},${sql.json(value)},${now})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at`;
  try {
    await sql`DELETE FROM settings WHERE key IN ${sql(keys)}`;
    assert.equal(await loadAutomationOverview(now), null);
    await set(keys[0]!, trial);
    await set(keys[2]!, { mode: 'agent-eval-auto-trial' });
    await sql`INSERT INTO sources (id,name,kind,tier) VALUES ('rss-inspect-ai','Overview fixture','rss','T1')`;
    ({ articleId } = await upsertMaterial({ sourceId: 'rss-inspect-ai', title: 'Agent evaluation evidence', url: 'https://example.org/overview-fixture',
      via: 'import', publishedAt: at, bodyText: 'Agent evaluation evidence with 150 trials and no successful coupled tasks.', bodyStatus: 'ok' }));
    await sql`UPDATE articles SET backfill=false, discovered_at=${at} WHERE id=${articleId}`;
    const summary = 'Agent 评测覆盖 150 例，耦合试点零任务成功。';
    const [receipt] = await sql`INSERT INTO receipts (logical_key,service,purpose,subject,status,response)
      VALUES ('overview-fixture','llm','understand_article',${`article:${articleId}@1`},'completed',
        ${sql.json({ choices: [{ message: { content: JSON.stringify({ titleZh: 'Agent 评测', summaryZh: summary }) } }] })}) RETURNING id`;
    receiptId = receipt!.id;
    await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,title_zh,summary_zh,selected,score,receipt_ids)
      VALUES (${articleId},1,'model','pass','methods','Agent 评测','旧摘要。',true,90,${[receipt!.id]})`;
    await publishArticle(articleId, { releasedAt: at });
    const [beforeCalls] = await sql`SELECT count(*) AS n FROM receipt_attempts`;
    const running = await loadAutomationOverview(now);
    assert.equal(running!.state, 'running');
    assert.equal(running!.daily.state, 'waiting');
    assert.equal(running!.daily.candidates, 1);
    const replay = await previewSummaryReplay([articleId]);
    assert.equal(replay.previews[0]!.after, summary);
    assert.equal(replay.writes, 0);
    await sql`INSERT INTO editorial_overrides(article_id,fields) VALUES (${articleId},'{"summary":"人工摘要"}')`;
    assert.equal((await previewSummaryReplay([articleId])).previews[0]!.status, 'manual-edit-preserved');
    await sql`DELETE FROM editorial_overrides WHERE article_id=${articleId}`;
    await set(keys[1]!, { at: now.toISOString(), modelRetryAt: '2020-01-02T03:00:00Z', reportCheck: { at: now.toISOString(), status: 'budget-waiting' } });
    assert.equal((await loadAutomationOverview(now))!.state, 'budget-waiting');
    assert.equal((await loadAutomationOverview(now))!.daily.state, 'budget-waiting');
    assert.equal((await loadAutomationOverview(new Date(trial.expiresAt)))!.state, 'expired', 'normal expiry takes precedence over stale heartbeat');
    await set(keys[0]!, { ...trial, state: 'stopped' });
    assert.equal((await loadAutomationOverview(now))!.state, 'stopped');
    await set(keys[0]!, trial);
    await sql`UPDATE settings SET updated_at=${new Date(+now - 4 * 60000)} WHERE key='heartbeat.worker'`;
    assert.equal((await loadAutomationOverview(now))!.state, 'offline');
    await set(keys[2]!, { mode: 'ordinary-worker' });
    assert.equal((await loadAutomationOverview(now))!.state, 'unexpected-worker');
    await set(keys[2]!, { mode: 'agent-eval-auto-trial' });
    await sql`UPDATE budgets SET per_day=per_day-1 WHERE service='llm'`;
    assert.equal((await loadAutomationOverview(now))!.state, 'budget-changed');
    await sql`UPDATE budgets SET per_day=${budget!.per_day} WHERE service='llm'`;
    await sql`UPDATE publications SET backfill=true WHERE article_id=${articleId}`;
    assert.equal((await loadAutomationOverview(now))!.daily.state, 'no-materials');
    await sql`INSERT INTO reports(kind,key,window_start,window_end,generated_at,content)
      VALUES ('daily','2020-01-02',${at},${now},${now},'{"lead":{"leadParagraph":"有依据的日报"}}')`;
    assert.equal((await loadAutomationOverview(now))!.daily.state, 'published');
    assert.equal((await app.inject({ method: 'GET', url: '/api/admin/runs' })).statusCode, 401);
    assert.equal((await sql`SELECT count(*) AS n FROM receipt_attempts`)[0]!.n, beforeCalls!.n);
    assert.equal((await sql`SELECT summary_zh FROM analyses WHERE article_id=${articleId}`)[0]!.summary_zh, '旧摘要。', 'preview never changes the analysis');
  } finally {
    await app.close();
    await sql`UPDATE budgets SET per_minute=${budget!.per_minute},per_hour=${budget!.per_hour},per_day=${budget!.per_day} WHERE service='llm'`;
    await sql`DELETE FROM reports WHERE kind='daily' AND key='2020-01-02'`;
    if (articleId) await sql`DELETE FROM articles WHERE id=${articleId}`;
    if (receiptId) await sql`DELETE FROM receipts WHERE id=${receiptId}`;
    await sql`DELETE FROM sources WHERE id='rss-inspect-ai'`;
    await sql`DELETE FROM settings WHERE key IN ${sql(keys)}`;
    for (const s of old) await sql`INSERT INTO settings(key,value,updated_at,updated_by) VALUES(${s.key},${sql.json(s.value)},${s.updated_at},${s.updated_by})`;
  }
});
