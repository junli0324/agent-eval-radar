import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { repairReviewEncoding, reviewRepairs } from "../industry/v0.1/repair-review-encoding.ts";

after(async () => { await stopBoss(); await closeDb(); });

test("encoding repair is atomic, preserves evidence and selection, republishes, and resumes without changes", async () => {
  process.env.MODEL_CALLS_ENABLED = "false";
  process.env.COLLECT_ENABLED = "false";
  const sourceId = `encoding-repair-${tag()}`;
  await sql`INSERT INTO sources (id, name, kind, tier, site_fulltext) VALUES (${sourceId}, 'Encoding test', 'external', 'T1_5', false)`;
  const ids: string[] = [];
  const [beforeCalls] = await sql`SELECT count(*) AS count FROM receipts`;
  try {
    for (const key of ["core-concepts", "2311.12983"]) {
      const spec = reviewRepairs.find(r => r.url.includes(key))!;
      const { articleId } = await upsertMaterial({ sourceId, url: spec.url, title: spec.originalTitle, bodyText: "Original material", bodyStatus: "ok", language: "en", via: "import", backfill: "encoding-test", raw: { trialCollection: "agent-eval-trial-2026-10" } });
      ids.push(articleId);
      const gaia = key === "2311.12983";
      await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, title_zh, summary_zh, score, selected, category)
        VALUES (${articleId}, 1, 'rule', ${gaia ? "unknown" : "pass"}, ${gaia ? "" : "Harbor 文档"}, '原始模型摘要', ${gaia ? 85 : 38}, false, ${gaia ? "benchmarks" : "tools"})`;
      const corrupted = JSON.parse(JSON.stringify(spec.fields).replace(/[^\x00-\x7f]/g, "?"));
      if (gaia) { corrupted.selected = true; corrupted.relevance = "pass"; }
      await sql`INSERT INTO editorial_overrides (article_id, fields, reason, updated_by)
        VALUES (${articleId}, ${sql.json(corrupted)}, '?????', 'local-trial-review')`;
    }
    await sql`UPDATE editorial_overrides SET updated_by = 'different-editor' WHERE article_id = ${ids[1]}`;
    await assert.rejects(repairReviewEncoding(), /Other editor/);
    const [rolledBack] = await sql`SELECT reason FROM editorial_overrides WHERE article_id = ${ids[0]}`;
    assert.equal(rolledBack!.reason, "?????");
    await sql`UPDATE editorial_overrides SET updated_by = 'local-trial-review' WHERE article_id = ${ids[1]}`;
    assert.equal((await repairReviewEncoding()).repaired, 2);
    assert.equal((await repairReviewEncoding()).repaired, 0);
    for (const [index, id] of ids.entries()) {
      const [p] = await sql`SELECT title, summary, tags, selected, eligible FROM publications WHERE article_id = ${id}`;
      assert.ok(p!.eligible);
      assert.equal(p!.selected, index === 1);
      assert.doesNotMatch([p!.title, p!.summary, ...p!.tags].join(" "), /\?{2,}/);
      const [a] = await sql`SELECT revision, body_text FROM articles WHERE id = ${id}`;
      assert.equal(a!.revision, 1);
      assert.equal(a!.body_text, "Original material");
    }
    const [afterCalls] = await sql`SELECT count(*) AS count FROM receipts`;
    assert.equal(afterCalls!.count, beforeCalls!.count);
  } finally {
    await sql`DELETE FROM articles WHERE source_id = ${sourceId}`;
    await sql`DELETE FROM sources WHERE id = ${sourceId}`;
  }
});
