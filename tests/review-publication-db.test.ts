import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { sha256 } from "@aihot/backend/lib/ids";
import { publishReviewPlan } from "../industry/v0.1/publish-coverage-final.ts";

after(async () => { await stopBoss(); await closeDb(); });

test("review publication rolls back stale batches and preserves score, evidence and selection on repeat", async () => {
  process.env.COLLECT_ENABLED = "false"; process.env.MODEL_CALLS_ENABLED = "false";
  const source = `review-publish-${tag()}`;
  const ids: string[] = [];
  const reviews = [];
  await sql`INSERT INTO sources (id, name, kind, tier, site_fulltext) VALUES (${source}, 'Review test', 'external', 'T1_5', false)`;
  const [before] = await sql`SELECT count(*) AS n FROM receipts`;
  try {
    for (let i = 0; i < 2; i++) {
      const url = `https://example.org/${source}/${i}`;
      const a = await upsertMaterial({ sourceId: source, url, title: 'Agent evaluation test', bodyText: 'Original abstract',
        bodyStatus: 'ok', via: 'import', backfill: 'test', raw: { trialCollection: 'agent-eval-trial-2026-10' } });
      ids.push(a.articleId);
      const title = 'Agent 评测'; const summary = '原始模型摘要'; const tags = ['评测方法'];
      await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, tags, title_zh, summary_zh, score, selected)
        VALUES (${a.articleId}, 1, 'rule', 'pass', 'methods', ${tags}, ${title}, ${summary}, ${i ? 22 : 88}, ${!i})`;
      reviews.push({ url, analysisHash: sha256(JSON.stringify([title, summary, tags])), fields: { category: 'methods', tags, summary: '已审核的中文摘要' } });
    }
    await sql`UPDATE articles SET revision = 2 WHERE id = ${ids[1]!}`;
    await assert.rejects(publishReviewPlan(reviews), /differs/);
    assert.equal((await sql`SELECT article_id FROM publications WHERE article_id IN ${sql(ids)}`).length, 0);
    assert.equal((await sql`SELECT article_id FROM editorial_overrides WHERE article_id IN ${sql(ids)}`).length, 0);
    await sql`UPDATE articles SET revision = 1 WHERE id = ${ids[1]!}`;
    assert.equal((await publishReviewPlan(reviews)).published, 2);
    const [auditBefore] = await sql`SELECT count(*) AS n FROM audit_log WHERE subject IN ${sql(ids.map(id => `content:${id}`))}`;
    await publishReviewPlan(reviews);
    const [auditAfter] = await sql`SELECT count(*) AS n FROM audit_log WHERE subject IN ${sql(ids.map(id => `content:${id}`))}`;
    assert.equal(auditBefore!.n, auditAfter!.n);
    for (const [i, id] of ids.entries()) {
      const [p] = await sql`SELECT score, selected, body_mode, summary FROM publications WHERE article_id = ${id}`;
      assert.equal(p!.score, i ? 22 : 88); assert.equal(p!.selected, !i);
      assert.equal(p!.body_mode, 'summary'); assert.equal(p!.summary, '已审核的中文摘要');
    }
    const [afterCalls] = await sql`SELECT count(*) AS n FROM receipts`;
    assert.equal(afterCalls!.n, before!.n);
  } finally {
    await sql`DELETE FROM articles WHERE id IN ${sql(ids)}`;
    await sql`DELETE FROM sources WHERE id = ${source}`;
  }
});
