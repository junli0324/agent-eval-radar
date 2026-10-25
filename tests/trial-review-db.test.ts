import './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { publishArticle } from '@aihot/backend/publication/publish';
import { trialReview } from '../industry/v0.1/trial-review.ts';

after(closeDb);

test('read-only review counts retries and expiry boundaries without treating unknown costs as free', async () => {
  process.env.COLLECT_ENABLED = 'false'; process.env.MODEL_CALLS_ENABLED = 'false';
  const startedAt = '2020-01-01T00:00:00.000Z', expiresAt = '2020-01-04T00:00:00.000Z';
  const [old] = await sql`SELECT value FROM settings WHERE key = 'agent-eval.auto-trial'`;
  const key = `trial-review-${Date.now()}`;
  const ids: number[] = [];
  const articles: string[] = [];
  const source = 'rss-tau2-bench';
  try {
    await sql`DELETE FROM settings WHERE key = 'agent-eval.auto-trial'`;
    assert.equal((await trialReview()).status, 'not-prepared');
    await sql`INSERT INTO settings (key, value) VALUES ('agent-eval.auto-trial', ${sql.json({ state: 'active', startedAt, expiresAt })})`;
    await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${source}, 'Review fixture', 'rss', 'T1')`;
    for (const kind of ['selected', 'ordinary', 'backfill', 'pending', 'withdrawn']) {
      const { articleId } = await upsertMaterial({ sourceId: source, title: kind, url: `https://example.org/${key}/${kind}`,
        via: 'import', bodyText: 'Agent evaluation evidence', bodyStatus: 'ok', publishedAt: new Date(startedAt),
        backfill: kind === 'backfill' ? 'review-fixture' : null });
      articles.push(articleId);
      // The old dates exercise the review window; assign archival status explicitly in this fixture.
      await sql`UPDATE articles SET backfill = ${kind === 'backfill'} WHERE id = ${articleId}`;
      const selected = kind !== 'ordinary';
      await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, selected, score)
        VALUES (${articleId}, 1, 'rule', 'pass', 'methods', '评测证据', '任务状态验证。', ${selected}, ${selected ? 90 : 22})`;
      await publishArticle(articleId, { releasedAt: new Date(startedAt) });
      await sql`UPDATE publications SET updated_at = ${startedAt}, visible_after = ${kind === 'pending' ? '2020-01-06T00:00:00Z' : startedAt}
        WHERE article_id = ${articleId}`;
      if (kind === 'withdrawn') await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${articleId}`;
    }
    for (const [reportKey, content] of [['2019-12-29', { title: 'Empty' }], ['2019-12-30', { sections: [{ items: [{ itemId: articles[0] }] }] }]] as const) {
      await sql`INSERT INTO reports (kind, key, window_start, window_end, generated_at, content)
        VALUES ('daily', ${reportKey}, ${startedAt}, ${expiresAt}, ${expiresAt}, ${sql.json(content)})`;
    }
    const [receipt] = await sql`INSERT INTO receipts (logical_key, service, purpose, status) VALUES (${key}, 'llm', 'review-fixture', 'completed') RETURNING id`;
    ids.push(receipt!.id);
    for (const [attempt, at, finished, cost, currency, basis, origin] of [
      [1, '2019-12-31T23:59:59Z', '2020-01-01T00:00:01Z', null, null, null, 'live'],
      [2, startedAt, startedAt, 0.1, 'CNY', 'actual', 'live'],
      [3, '2020-01-03T23:59:59Z', expiresAt, 0.2, 'USD', 'estimated', 'live'],
      [4, expiresAt, expiresAt, null, null, null, 'live'],
      [5, expiresAt, expiresAt, 999, 'USD', 'actual', 'replay'],
      [6, '2020-01-06T00:00:00Z', '2020-01-06T00:00:00Z', 999, 'USD', 'actual', 'live'],
    ] as const) await sql`INSERT INTO receipt_attempts (receipt_id, attempt, service, status, origin, started_at, finished_at, usage, cost, currency, cost_basis)
      VALUES (${receipt!.id}, ${attempt}, 'llm', 'received', ${origin}, ${at}, ${finished}, '{"total_tokens":10}', ${cost}, ${currency}, ${basis})`;
    const [before] = await sql`SELECT count(*) AS n FROM receipt_attempts`;
    const result = await trialReview(new Date('2020-01-05T00:00:00Z'));
    assert.equal(result.status, 'expired');
    assert.equal(result.requests!.attempts, 3);
    assert.equal(result.requests!.logical_requests, 1);
    assert.equal(result.requests!.started_after_expiry, 1);
    assert.equal(result.requests!.finished_after_expiry, 1);
    assert.equal(result.requests!.recorded_tokens, 30);
    assert.equal(result.requests!.unknown_cost_attempts, 1);
    assert.deepEqual(result.costs!.map(c => [c.currency, c.cost_basis, c.amount]), [['CNY', 'actual', 0.1], ['USD', 'estimated', 0.2]]);
    assert.equal(result.steps!.find(s => s.purpose === 'review-fixture')!.attempts, 3);
    assert.deepEqual({ ...result.publications }, { readable: 3, selected_live: 1, ordinary_live: 1, backfill: 1 });
    assert.equal(result.reports!.find(r => r.key === '2019-12-29')!.readable, false);
    assert.equal(result.reports!.find(r => r.key === '2019-12-30')!.citations, 1);
    assert.equal(result.reports!.find(r => r.key === '2019-12-30')!.readable, true);
    assert.equal(result.modelCalls, 0);
    assert.equal((await sql`SELECT count(*) AS n FROM receipt_attempts`)[0]!.n, before!.n);
    assert.deepEqual((await sql`SELECT value FROM settings WHERE key = 'agent-eval.auto-trial'`)[0]!.value, { state: 'active', startedAt, expiresAt });
    process.env.MODEL_CALLS_ENABLED = 'true';
    await assert.rejects(trialReview(), /MODEL_CALLS_ENABLED=false/);
  } finally {
    process.env.MODEL_CALLS_ENABLED = 'false';
    if (ids.length) await sql`DELETE FROM receipts WHERE id IN ${sql(ids)}`;
    await sql`DELETE FROM reports WHERE kind = 'daily' AND key IN ('2019-12-29', '2019-12-30')`;
    if (articles.length) await sql`DELETE FROM articles WHERE id IN ${sql(articles)}`;
    await sql`DELETE FROM sources WHERE id = ${source}`;
    await sql`DELETE FROM settings WHERE key = 'agent-eval.auto-trial'`;
    if (old) await sql`INSERT INTO settings (key, value) VALUES ('agent-eval.auto-trial', ${sql.json(old.value)})`;
  }
});
