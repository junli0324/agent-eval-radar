import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { dailyPreview, generateRecentDaily, publishRecent, recentRows, runRecent } from "../industry/v0.1/recent-trial.ts";

after(async () => { await stopBoss(); await closeDb(); });

test("recent trial excludes history and atomically rejects damaged public overrides without changing selection", async () => {
  const sourceId = "rss-deepeval";
  const inserted = await sql`INSERT INTO sources (id, name, kind, participation_mode, site_fulltext, syndicate_fulltext, tier)
    VALUES (${sourceId}, 'Recent trial test', 'rss', 'editorial', false, false, 'T1') ON CONFLICT (id) DO NOTHING RETURNING id`;
  const ids: string[] = [];
  const [before] = await sql`SELECT count(*) AS n FROM receipts`;
  try {
    for (const backfill of [false, false, true]) {
      const a = await upsertMaterial({ sourceId, title: "Recent agent evaluation test", url: `https://example.org/recent/${Date.now()}-${ids.length}`,
        publishedAt: new Date(Date.now() - 3600000), bodyText: "Agent task success is verified against final state. ".repeat(10), bodyStatus: "ok", via: "import", backfill: backfill ? "test-history" : null });
      ids.push(a.articleId);
      await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, tags)
        VALUES (${a.articleId}, 1, 'rule', 'pass', 'methods', 'Agent 评测测试', '以最终状态验证任务完成情况。', 22, false, ARRAY['评测方法'])`;
    }
    const rows = await recentRows();
    assert.equal(rows.some(a => a.id === ids[0]), true);
    assert.equal(rows.some(a => a.id === ids[2]), false);
    await assert.rejects(publishRecent([ids[2]!]), /current/);
    await sql`INSERT INTO editorial_overrides (article_id, fields, reason) VALUES (${ids[1]!}, '{"summary":"Harbor ???"}', 'test')`;
    await assert.rejects(publishRecent(ids.slice(0, 2)), /rolled back/);
    assert.equal((await sql`SELECT article_id FROM publications WHERE article_id IN ${sql(ids)}`).length, 0);
    await sql`DELETE FROM editorial_overrides WHERE article_id = ${ids[1]!}`;
    await publishRecent(ids.slice(0, 2));
    await publishRecent(ids.slice(0, 2));
    const published = await sql`SELECT selected, body_mode FROM publications WHERE article_id IN ${sql(ids)}`;
    assert.equal(published.length, 2);
    assert.equal(published.every(a => a.selected === false && a.body_mode === 'summary'), true);
    await sql`UPDATE articles SET revision = revision + 1 WHERE id = ${ids[0]!}`;
    await assert.rejects(publishRecent([ids[0]!]), /current/);
    process.env.COLLECT_ENABLED = "false";
    process.env.MODEL_CALLS_ENABLED = "false";
    await assert.rejects(runRecent(["analyze", `--ids=${ids[0]}`]), /MODEL_CALLS_ENABLED=true/);
    const [afterCalls] = await sql`SELECT count(*) AS n FROM receipts`;
    assert.equal(afterCalls!.n, before!.n);
  } finally {
    await sql`DELETE FROM articles WHERE id IN ${sql(ids)}`;
    if (inserted.length) await sql`DELETE FROM sources WHERE id = ${sourceId}`;
  }
});

test("empty/existing daily editions are skipped without model calls or new revisions", async () => {
  const date = "2001-02-03";
  const [before] = await sql`SELECT count(*) AS n FROM receipts`;
  try {
    const preview = await dailyPreview(date);
    assert.equal(preview.fresh, 0);
    assert.equal((await generateRecentDaily(date)).status, "no-eligible-content");
    assert.equal((await sql`SELECT key FROM reports WHERE kind = 'daily' AND key = ${date}`).length, 0);
    await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at)
      VALUES ('daily', ${date}, '2001-02-02T00:00:00Z', '2001-02-03T00:00:00Z', '{"sections":[]}', now())`;
    assert.equal((await generateRecentDaily(date)).status, "already-present");
    const [report] = await sql`SELECT revision FROM reports WHERE kind = 'daily' AND key = ${date}`;
    assert.equal(report!.revision, 1);
    const [afterCalls] = await sql`SELECT count(*) AS n FROM receipts`;
    assert.equal(afterCalls!.n, before!.n);
  } finally { await sql`DELETE FROM reports WHERE kind = 'daily' AND key = ${date}`; }
});

test("daily preview reads released selection, excludes backfill and suppresses previous editions", async () => {
  const source = `recent-preview-${Date.now()}`;
  const ids: string[] = [];
  await sql`INSERT INTO sources (id, name, kind, tier, site_fulltext) VALUES (${source}, 'Daily preview test', 'rss', 'T1', false)`;
  try {
    for (const backfill of [false, true]) {
      const at = new Date("2002-03-03T12:00:00Z");
      const a = await upsertMaterial({ sourceId: source, title: "Agent evaluation", url: `https://example.org/${source}/${ids.length}`,
        publishedAt: at, discoveredAt: at, via: "import", backfill: backfill ? "history" : null });
      ids.push(a.articleId);
      await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
        VALUES (${a.articleId}, 1, 'rule', 'pass', 'benchmarks', 'Agent 基准测试', '测试摘要', 88, true)`;
      await publishArticle(a.articleId, { now: at, releasedAt: at });
    }
    const initial = await dailyPreview("2002-03-04");
    assert.deepEqual(initial.articles.map(a => a.id), [ids[0]]);
    await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at)
      VALUES ('daily', '2002-03-03', '2002-03-02T00:00:00Z', '2002-03-03T00:00:00Z',
        ${sql.json({ sections: [{ items: [{ itemId: ids[0] }] }] })}, now())`;
    const suppressed = await dailyPreview("2002-03-04");
    assert.equal(suppressed.fresh, 0);
    assert.equal(suppressed.repeatsSuppressed, 1);
  } finally {
    await sql`DELETE FROM reports WHERE kind = 'daily' AND key = '2002-03-03'`;
    await sql`DELETE FROM articles WHERE id IN ${sql(ids)}`;
    await sql`DELETE FROM sources WHERE id = ${source}`;
  }
});
