import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { composeDaily, composeWeekly, composeMonthly, catchUpReports } from "@aihot/backend/reports/compose";
import { reportContentSql, hasReportContent } from "@aihot/backend/publication/report-content";
import { loadReport, reportIndexRows, v1Daily, loadArchiveReviewMaterials } from "@aihot/backend/publication/reports";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { readingReview } from "../industry/v0.1/reading-review.ts";

after(async () => { await stopBoss(); await closeDb(); });

test("empty generation makes no report or paid request; old placeholders remain stored but unlisted", async () => {
  const [before] = await sql`SELECT count(*) AS n FROM receipts`;
  const dates = ["2003-01-01", "2003-01-02", "2003-01-03"];
  try {
    await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at)
      VALUES ('daily', ${dates[1]!}, '2003-01-01', '2003-01-02', '{"title":"Placeholder","sections":[]}', now())`;
    assert.equal((await composeDaily(dates[0]!)).entries, 0);
    assert.equal((await composeWeekly("2003-W01")).entries, 0);
    assert.equal((await composeMonthly("2003-01")).entries, 0);
    const caughtUp = await catchUpReports(new Date("2003-01-03T12:00:00Z"), 2);
    assert.deepEqual(caughtUp.generated, []);
    assert.equal(await loadReport("daily", dates[1]!), null);
    assert.equal(await v1Daily(dates[1]!), null);
    assert.equal((await reportIndexRows("daily", 400)).some(r => r.key === dates[1]), false);
    const [stored] = await sql`SELECT revision FROM reports WHERE kind = 'daily' AND key = ${dates[1]!}`;
    assert.equal(stored!.revision, 1, "no deletion or pointless revision of an existing placeholder");
    assert.equal((await sql`SELECT 1 FROM reports WHERE kind = 'weekly' AND key = '2003-W01'`).length, 0);
    const [afterCalls] = await sql`SELECT count(*) AS n FROM receipts`;
    assert.equal(afterCalls!.n, before!.n);
    for (const content of [{ overview: "  " }, { overview: "Real prose" }, { sections: [{ items: [{ title: "Old citation" }] }] }]) {
      const [row] = await sql`SELECT ${reportContentSql(sql`${sql.json(content)}::jsonb`)} AS readable`;
      assert.equal(row!.readable, hasReportContent(content));
    }
  } finally {
    await sql`DELETE FROM reports WHERE kind = 'daily' AND key IN ${sql(dates)}`;
  }
});

test("archival issue includes only released, selected, dated public material; publishes once with no model calls", async () => {
  process.env.COLLECT_ENABLED = "false"; process.env.MODEL_CALLS_ENABLED = "false";
  const source = `reading-review-${tag()}`;
  const ids: string[] = [];
  const [before] = await sql`SELECT count(*) AS n FROM receipts`;
  await sql`INSERT INTO sources (id, name, kind, tier, site_fulltext) VALUES (${source}, 'Reading test', 'external', 'T1_5', false)`;
  try {
    for (let i = 0; i < 5; i++) {
      const at = new Date(i === 4 ? "2004-06-01T00:00:00Z" : "2004-05-26T00:00:00Z");
      const { articleId } = await upsertMaterial({ sourceId: source, url: `https://example.org/${source}/${i}`, title: 'Agent eval paper',
        publishedAt: at, bodyText: 'Original abstract', bodyStatus: 'ok', via: 'import', backfill: 'test-archive' });
      ids.push(articleId);
      await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
        VALUES (${articleId}, 1, 'rule', 'pass', 'benchmarks', '评测资料', '原有中文摘要', ${i === 1 ? 22 : 88}, ${i !== 1})`;
      await publishArticle(articleId, { now: at, releasedAt: at });
    }
    await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${ids[2]!}`;
    await sql`UPDATE publications SET visible_after = '2100-01-01' WHERE article_id = ${ids[3]!}`;
    const start = new Date("2004-05-23T16:00:00Z"); const end = new Date("2004-05-30T16:00:00Z");
    const materials = await loadArchiveReviewMaterials(start, end);
    assert.deepEqual(materials.map(r => r.itemId), [ids[0]]);
    const result = await readingReview("2004-W22", true);
    assert.equal(result.status, "published");
    const report = await loadReport("weekly", "2004-W22");
    assert.match(report!.lead!.title, /补录/); assert.equal(report!.stories.length, 1);
    assert.equal(report!.stories[0]!.summary, '原有中文摘要');
    assert.equal((await readingReview("2004-W22", true)).status, "already-present");
    const [saved] = await sql`SELECT revision, origin FROM reports WHERE kind = 'weekly' AND key = '2004-W22'`;
    assert.equal(saved!.revision, 1); assert.equal(saved!.origin, 'manual');
    const [article] = await sql`SELECT backfill FROM articles WHERE id = ${ids[0]!}`;
    assert.equal(article!.backfill, true);
    const [afterCalls] = await sql`SELECT count(*) AS n FROM receipts`;
    assert.equal(afterCalls!.n, before!.n);
  } finally {
    await sql`DELETE FROM reports WHERE kind = 'weekly' AND key = '2004-W22'`;
    await sql`DELETE FROM articles WHERE id IN ${sql(ids)}`;
    await sql`DELETE FROM sources WHERE id = ${source}`;
  }
});
