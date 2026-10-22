import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadContentUpdates } from "@aihot/backend/publication/updates";
import { buildApp } from "../apps/api/src/app.ts";

after(async () => { await stopBoss(); await closeDb(); });

test("notifications use public release time, exclude blocked/pending/withdrawn/raw items and empty reports", async () => {
  process.env.COLLECT_ENABLED = "false"; process.env.MODEL_CALLS_ENABLED = "false";
  const source = "updates-fixture";
  const now = new Date("2025-02-15T12:00:00.000Z");
  const at = new Date(+now - 60_000);
  const since = new Date(+now - 120_000);
  const ids: string[] = [];
  const app = await buildApp();
  const [calls] = await sql`SELECT count(*) AS n FROM receipt_attempts`;
  try {
    await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${source}, 'Update test', 'rss', 'T1')`;
    for (const kind of ["ordinary", "selected", "pending", "blocked", "withdrawn", "summary-only", "raw"]) {
      const { articleId } = await upsertMaterial({ sourceId: source, url: `https://example.org/update-${kind}`,
        title: kind, via: "import", bodyText: "Agent evaluation evidence", bodyStatus: "ok", publishedAt: new Date("2024-01-01") });
      ids.push(articleId);
      if (kind === "raw") continue;
      const selected = kind === "selected" || kind === "pending";
      await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, selected, score)
        VALUES (${articleId}, 1, 'rule', ${kind === 'blocked' ? 'block' : 'pass'}, 'methods', ${`通知-${kind}`}, '通过任务状态检验 Agent。', ${selected}, ${selected ? 90 : 22})`;
      await publishArticle(articleId, { releasedAt: at });
      await sql`UPDATE publications SET updated_at = ${at}, visible_after = ${kind === 'pending' ? new Date(+now + 60_000) : at} WHERE article_id = ${articleId}`;
      if (kind === "withdrawn" || kind === "summary-only") await sql`UPDATE publications SET visibility = ${kind} WHERE article_id = ${articleId}`;
    }
    for (const [kind, key, content] of [
      ["daily", "2025-02-14", { lead: { leadParagraph: "今日评测进展" } }],
      ["weekly", "2025-W07", { overview: "本周评测进展" }],
      ["monthly", "2025-01", { overview: "本月评测进展" }],
      ["daily", "2025-02-13", { title: "Empty report must not notify" }],
    ] as const) await sql`INSERT INTO reports (kind, key, window_start, window_end, generated_at, content)
      VALUES (${kind}, ${key}, ${since}, ${now}, ${at}, ${sql.json(content)})`;

    const update = await loadContentUpdates(since, now);
    assert.equal(update.articles, 2); assert.equal(update.reports, 3);
    assert.deepEqual(update.entries.filter(e => e.kind === 'article').map(e => e.title).sort(), ['通知-ordinary', '通知-selected']);
    assert.equal(update.latestAt, at.toISOString());
    assert.equal(update.entries.find(e => e.kind === 'weekly')!.href, '/weekly/2025-W07');
    assert.equal((await loadContentUpdates(at, now)).articles, 0, "watermark boundary does not recount acknowledged publications");
    const first = await loadContentUpdates(null, now);
    assert.equal(first.articles + first.reports, 0, "first visit shows recent links without historical unread spam");
    assert.equal(first.entries.length, 5);
    await sql`UPDATE publications SET updated_at = ${new Date(+now - 10_000)} WHERE article_id = ${ids[0]!}`;
    assert.equal((await loadContentUpdates(at, now)).articles, 1, "public revisions also notify");

    for (const value of ['broken', '', '2099-01-01T00:00:00.000Z']) {
      assert.equal((await app.inject({ method: 'GET', url: `/api/site/updates?since=${encodeURIComponent(value)}` })).statusCode, 400);
    }
    const response = await app.inject({ method: 'GET', url: '/api/site/updates' });
    assert.equal(response.statusCode, 200); assert.match(response.headers['cache-control']!, /no-store/);
    assert.equal((await sql`SELECT count(*) AS n FROM receipt_attempts`)[0]!.n, calls!.n);
  } finally {
    await app.close();
    await sql`DELETE FROM reports WHERE (kind = 'daily' AND key IN ('2025-02-14', '2025-02-13')) OR (kind = 'weekly' AND key = '2025-W07') OR (kind = 'monthly' AND key = '2025-01')`;
    if (ids.length) await sql`DELETE FROM articles WHERE id IN ${sql(ids)}`;
    await sql`DELETE FROM sources WHERE id = ${source}`;
  }
});
