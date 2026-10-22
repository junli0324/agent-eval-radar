// Run this UTF-8 file from disk; do not pipe Chinese source through Windows PowerShell.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql, closeDb } from "@aihot/backend/db";
import { stableJson } from "@aihot/backend/lib/ids";
import { publishArticleTx } from "@aihot/backend/publication/publish";
import { stopBoss } from "@aihot/backend/jobs/queue";

export interface ReviewRepair { url: string; originalTitle: string; fields: Record<string, unknown> }
export const reviewRepairs: ReviewRepair[] = JSON.parse(readFileSync(new URL("local-review-20261019.json", import.meta.url), "utf8"));
const REASON = "修复 Windows PowerShell 中文管道编码损坏；恢复已审核字段，保留原分析、回执、评分和精选判定。";
export const hasEncodingDamage = (v: unknown): boolean => typeof v === "string"
  ? /\?{2,}|\uFFFD/.test(v) : Array.isArray(v) && v.some(hasEncodingDamage);

/** Restore only damaged keys from the reviewed specification, never unrelated or clean edits. */
export function repairedFields(before: Record<string, unknown>, spec: ReviewRepair) {
  const next = { ...before };
  for (const [key, value] of Object.entries(before)) {
    if (!hasEncodingDamage(value)) continue;
    if (!(key in spec.fields)) throw new Error(`Unrecognized damaged field: ${key}`);
    next[key] = spec.fields[key];
  }
  if (Object.values(next).some(hasEncodingDamage)) throw new Error("Encoding damage remains");
  return next;
}

export async function repairReviewEncoding() {
  if (process.env.MODEL_CALLS_ENABLED !== "false" || process.env.COLLECT_ENABLED !== "false") throw new Error("Run with COLLECT_ENABLED=false and MODEL_CALLS_ENABLED=false");
  return sql.begin(async tx => {
    const results: { articleId: string; changed: boolean; publicTextOk: boolean; selected: boolean }[] = [];
    let skipped = 0;
    for (const spec of reviewRepairs) {
      const [a] = await tx`SELECT id, title, revision FROM articles
        WHERE url = ${spec.url} AND raw->>'trialCollection' = 'agent-eval-trial-2026-10' FOR UPDATE`;
      if (!a) { skipped++; continue; }
      const [o] = await tx`SELECT * FROM editorial_overrides WHERE article_id = ${a.id} FOR UPDATE`;
      if (!o) { skipped++; continue; }
      const [analysis] = await tx`SELECT input_revision FROM analyses WHERE article_id = ${a.id} ORDER BY input_revision DESC, id DESC LIMIT 1`;
      if (a.title !== spec.originalTitle || analysis?.input_revision !== a.revision) throw new Error(`Material changed; no repair committed: ${a.id}`);
      const next = repairedFields(o.fields, spec);
      const changed = stableJson(next) !== stableJson(o.fields) || hasEncodingDamage(o.reason);
      if (changed) {
        if (!["local-trial-review", "local-trial-utf8-repair"].includes(o.updated_by)) throw new Error(`Other editor owns this correction: ${a.id}`);
        await tx`UPDATE editorial_overrides SET fields = ${tx.json(next as never)}, reason = ${REASON},
          version = version + 1, updated_by = 'local-trial-utf8-repair', updated_at = now() WHERE article_id = ${a.id}`;
        await tx`INSERT INTO audit_log (actor, action, subject, reason, before, after)
          VALUES ('local-trial-utf8-repair', 'content.encoding-repair', ${`content:${a.id}`}, ${REASON},
          ${tx.json({ fields: o.fields, reason: o.reason } as never)}, ${tx.json({ fields: next, reason: REASON } as never)})`;
      }
      await publishArticleTx(tx, a.id);
      const [p] = await tx`SELECT title, summary, tags, selected FROM publications WHERE article_id = ${a.id}`;
      if (!p || [p.title, p.summary, p.tags].some(hasEncodingDamage)) throw new Error(`Published text check failed; no repair committed: ${a.id}`);
      results.push({ articleId: a.id, changed, publicTextOk: true, selected: p.selected });
    }
    return { checked: results.length, repaired: results.filter(r => r.changed).length, skipped, modelCalls: 0, results };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await repairReviewEncoding(), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "Repair failed"); process.exitCode = 1; }
  finally { await stopBoss(); await closeDb(); }
}
