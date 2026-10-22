import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { SOURCE_ID, importAbstract, importCoveragePage, publishReviewed, trialRows, trialOverview } from "../industry/v0.1/trial-library.ts";
import { coverageCatalog, candidateSourceId } from "../industry/v0.1/coverage-materials.ts";

after(async () => { await stopBoss(); await closeDb(); });

test("trial import resumes without duplicates or paid calls; publication requires current relevant copy", async () => {
  process.env.MODEL_CALLS_ENABLED = "false";
  await sql`INSERT INTO sources (id, name, kind, participation_mode, site_fulltext, syndicate_fulltext)
    VALUES (${SOURCE_ID}, 'arXiv trial test', 'rss', 'editorial', false, false) ON CONFLICT (id) DO NOTHING`;
  const [before] = await sql`SELECT count(*) AS count FROM receipts`;
  const html = `<meta name="citation_arxiv_id" content="2404.07972"><meta name="citation_title" content="Trial agent evaluation">
    <meta name="citation_date" content="2024/04/11"><blockquote class="abstract">${"We evaluate agent task success in a reproducible environment with verifiable final states. ".repeat(4)}</blockquote>`;
  const first = await importAbstract("2404.07972", html);
  try {
    const again = await importAbstract("2404.07972", html);
    assert.equal(again.articleId, first.articleId);
    assert.equal(again.created, false);
    assert.equal(again.revised, false);
    const [a] = await sql`SELECT revision, backfill, published_at, timeline_at FROM articles WHERE id = ${first.articleId}`;
    assert.equal(a!.backfill, true);
    assert.equal(a!.timeline_at.toISOString(), "2024-04-11T00:00:00.000Z");
    assert.equal((await trialRows()).find(r => r.id === first.articleId)?.body_status, "ok");
    await assert.rejects(publishReviewed([first.articleId]), /current/);
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
      VALUES (${first.articleId}, ${a!.revision}, 'rule', 'pass', 'benchmarks', '测试 Agent 评测', '仅供测试的论文摘要。', 22, false)`;
    await assert.rejects(publishReviewed([first.articleId, "not-a-trial-id"]), /current/);
    assert.equal((await sql`SELECT article_id FROM publications WHERE article_id = ${first.articleId}`).length, 0);
    await publishReviewed([first.articleId]);
    const [p] = await sql`SELECT eligible, selected, body_mode FROM publications WHERE article_id = ${first.articleId}`;
    assert.equal(p!.eligible, true);
    assert.equal(p!.selected, false, "related content must not be promoted to selected");
    assert.equal(p!.body_mode, "summary");
    await sql`UPDATE articles SET revision = revision + 1 WHERE id = ${first.articleId}`;
    await assert.rejects(publishReviewed([first.articleId]), /current/);
    const [afterCalls] = await sql`SELECT count(*) AS count FROM receipts`;
    assert.equal(afterCalls!.count, before!.count);
  } finally {
    await sql`DELETE FROM articles WHERE id = ${first.articleId}`;
  }
});

test("coverage sources stay unscheduled; snapshots deduplicate and status includes effective public fields", async () => {
  const c = coverageCatalog.find(c => c.id === "inspect-cyber-docs")!;
  const html = `<html><body><main><h1>${c.name}</h1><p>${"Agent evaluations execute in a sandbox with explicit tasks, tools, and outcome verification. ".repeat(10)}</p></main></body></html>`;
  const first = await importCoveragePage(c, html, c.url!);
  try {
    const second = await importCoveragePage(c, html, c.url!);
    assert.equal(second.articleId, first.articleId);
    assert.equal(second.revised, false);
    const [source] = await sql`SELECT enabled, site_fulltext FROM sources WHERE id = ${candidateSourceId(c)}`;
    assert.equal(source!.enabled, false);
    assert.equal(source!.site_fulltext, false);
    assert.equal((await trialRows("base")).some(r => r.id === first.articleId), false);
    const a = (await trialRows("coverage")).find(r => r.id === first.articleId)!;
    assert.equal(a.published_at, null);
    assert.equal(a.material_scope, "documentation-snapshot");
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
      VALUES (${first.articleId}, ${a.revision}, 'rule', 'pass', 'tools', '模型标题', '工具文档摘要', 22, false)`;
    await sql`INSERT INTO editorial_overrides (article_id, fields, reason) VALUES (${first.articleId}, '{"title":"人工修正标题","tags":["工具框架","安全"]}'::jsonb, 'trial test')`;
    await publishReviewed([first.articleId]);
    const p = (await trialRows("coverage")).find(r => r.id === first.articleId)!;
    assert.equal(p.title_zh, "模型标题");
    assert.equal(p.public_title, "人工修正标题");
    assert.deepEqual(p.public_tags, ["工具框架", "安全"]);
    const overview = await trialOverview("coverage");
    assert.equal(overview.categories.tools, 1);
    await sql`UPDATE sources SET site_fulltext = true WHERE id = ${candidateSourceId(c)}`;
    await assert.rejects(importCoveragePage(c, html, c.url!), /settings differ/);
    const [unchanged] = await sql`SELECT site_fulltext FROM sources WHERE id = ${candidateSourceId(c)}`;
    assert.equal(unchanged!.site_fulltext, true, "do not overwrite manual source settings");
  } finally {
    await sql`DELETE FROM articles WHERE id = ${first.articleId}`;
    await sql`UPDATE sources SET site_fulltext = false WHERE id = ${candidateSourceId(c)}`;
  }
});
