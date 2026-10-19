// Apply the final coverage reviews and the held DeepSWE correction from UTF-8 files.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql, closeDb } from "@aihot/backend/db";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
import { publishArticleTx } from "@aihot/backend/publication/publish";
import { stopBoss } from "@aihot/backend/jobs/queue";

interface Review { url: string; analysisHash: string; fields: Record<string, unknown> }
interface Analysis { revision: number; input_revision: number; relevance: string | null; title_zh: string | null; summary_zh: string | null; tags: string[] }
export const finalReviews: Review[] = JSON.parse(readFileSync(new URL("coverage-final-review.json", import.meta.url), "utf8"));

export function validateReviewedAnalysis(a: Analysis, spec: Review) {
  if (a.input_revision !== a.revision || a.relevance !== "pass" || !a.title_zh || !a.summary_zh ||
    sha256(JSON.stringify([a.title_zh, a.summary_zh, a.tags])) !== spec.analysisHash) throw new Error("Analysis differs from the reviewed result; nothing committed");
  if (Object.keys(spec.fields).some(k => !["title", "summary", "reason", "category", "tags"].includes(k))) throw new Error("Only reviewed copy and classification may change");
}

export async function publishCoverageFinal() {
  if (process.env.COLLECT_ENABLED !== "false" || process.env.MODEL_CALLS_ENABLED !== "false") throw new Error("Run with COLLECT_ENABLED=false and MODEL_CALLS_ENABLED=false");
  return sql.begin(async tx => {
    const results = [];
    for (const spec of finalReviews) {
      const [a] = await tx`SELECT id, revision FROM articles WHERE url = ${spec.url}
        AND raw->>'trialCollection' = 'agent-eval-trial-2026-10' FOR UPDATE`;
      if (!a) throw new Error(`Reviewed article not found: ${spec.url}`);
      const [analysis] = await tx`SELECT input_revision, relevance, title_zh, summary_zh, tags FROM analyses
        WHERE article_id = ${a.id} ORDER BY input_revision DESC, id DESC LIMIT 1`;
      if (!analysis) throw new Error("Analysis missing");
      validateReviewedAnalysis({ ...analysis, revision: a.revision } as Analysis, spec);
      const [o] = await tx`SELECT * FROM editorial_overrides WHERE article_id = ${a.id} FOR UPDATE`;
      for (const [key, value] of Object.entries(spec.fields)) {
        if (o && key in o.fields && stableJson(o.fields[key]) !== stableJson(value)) throw new Error(`Existing manual edit differs; nothing committed: ${a.id}`);
      }
      const fields = { ...(o?.fields ?? {}), ...spec.fields };
      if (!o || stableJson(fields) !== stableJson(o.fields)) {
        const reason = "人工审核补充集最后四条及此前暂缓的 DeepSWE：统一分类标签、明确证据范围，保留原评分和精选判定。";
        await tx`INSERT INTO editorial_overrides (article_id, fields, reason, updated_by)
          VALUES (${a.id}, ${tx.json(fields as never)}, ${reason}, 'local-trial-final-review')
          ON CONFLICT (article_id) DO UPDATE SET fields = EXCLUDED.fields, reason = EXCLUDED.reason,
            version = editorial_overrides.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()`;
        await tx`INSERT INTO audit_log (actor, action, subject, reason, before, after)
          VALUES ('local-trial-final-review', 'content.review-publish', ${`content:${a.id}`}, ${reason},
            ${tx.json((o?.fields ?? {}) as never)}, ${tx.json(fields as never)})`;
      }
      const published = await publishArticleTx(tx, a.id);
      const [p] = await tx`SELECT title, summary, tags, eligible FROM publications WHERE article_id = ${a.id}`;
      if (!p?.eligible || /\?{2,}|\uFFFD/.test([p.title, p.summary, ...p.tags].join(" "))) throw new Error("Published copy check failed; nothing committed");
      results.push({ ...published, publicTextOk: true });
    }
    return { published: results.length, modelCalls: 0, results };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await publishCoverageFinal(), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "Publication failed"); process.exitCode = 1; }
  finally { await stopBoss(); await closeDb(); }
}
