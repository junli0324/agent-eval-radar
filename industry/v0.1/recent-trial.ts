// Manual recent-content trial. Never starts/drains the worker or alters thresholds/history.
import { fileURLToPath } from "node:url";
import { addDays } from "@aihot/contracts/time";
import { sql, closeDb } from "@aihot/backend/db";
import { collectSource } from "@aihot/backend/sources/collect";
import { extractArticleBody } from "@aihot/backend/content/extract";
import { analyzeArticle } from "@aihot/backend/editorial/analyze";
import { publishArticleTx } from "@aihot/backend/publication/publish";
import { candidates, composeDaily } from "@aihot/backend/reports/compose";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { RECENT_SOURCES, RECENT_DAYS, assertRecent, dailyWindow, recentOptions, recentValves, damagedCopy } from "./recent-policy.ts";

export async function recentRows(now = new Date()) {
  const cutoff = new Date(now.getTime() - RECENT_DAYS * 86400000);
  return sql`SELECT a.id, a.source_id, a.title, a.url, a.published_at, a.discovered_at,
      a.backfill, a.revision, a.body_status, length(a.body_text) AS body_chars,
      n.id AS analysis_id, n.input_revision, n.relevance, n.selected, n.score,
      n.category, n.tags, n.title_zh, n.summary_zh, n.reason_zh,
      p.visibility AS public_visibility, p.selected AS public_selected, p.visible_after
    FROM articles a JOIN sources s ON s.id = a.source_id
    LEFT JOIN LATERAL (SELECT * FROM analyses WHERE article_id = a.id ORDER BY input_revision DESC, id DESC LIMIT 1) n ON true
    LEFT JOIN publications p ON p.article_id = a.id
    WHERE a.source_id IN ${sql(RECENT_SOURCES)} AND s.participation_mode = 'editorial'
      AND NOT a.backfill AND a.published_at >= ${cutoff} AND a.published_at <= ${now}
      AND a.discovered_at >= ${cutoff}
    ORDER BY a.published_at DESC, a.id`;
}

export async function recentStatus() {
  const sources = await sql`SELECT s.id, s.name, s.enabled, s.health, s.fail_count,
      s.last_ok_at, s.next_fetch_at, (s.cursor->>'initializedAt') IS NOT NULL AS initialized,
      (SELECT count(*)::int FROM articles a WHERE a.source_id = s.id AND a.backfill) AS archived_count,
      r.status AS last_run_status, r.found_count, r.new_count, r.finished_at
    FROM sources s LEFT JOIN LATERAL (SELECT * FROM fetch_runs WHERE source_id = s.id ORDER BY id DESC LIMIT 1) r ON true
    WHERE s.id IN ${sql(RECENT_SOURCES)} ORDER BY s.id`;
  const rows = await recentRows();
  return { sources, recentCandidates: rows.length, readyForAnalysis: rows.filter(a => a.body_status === "ok" && a.input_revision !== a.revision).length,
    articles: rows.slice(0, 20), showing: Math.min(rows.length, 20),
    note: "Only dated non-backfill articles from the last 14 days. Archived items and the historical trial library stay unchanged. Worker must remain stopped." };
}

export async function dailyPreview(date?: string, now = new Date()) {
  const window = dailyWindow(date, now);
  const all = await candidates(window.start, window.end);
  const prior = await sql`SELECT content FROM reports WHERE kind = 'daily' AND key < ${window.key} AND key >= ${addDays(window.key, -7)}`;
  const covered = new Set<string>();
  for (const r of prior) for (const section of r.content.sections ?? []) for (const item of section.items ?? []) {
    if (item.itemId) covered.add(`a:${item.itemId}`);
    if (item.factId) covered.add(item.factId);
  }
  const fresh = all.filter(a => !covered.has(a.factKey) && !covered.has(`a:${a.itemId}`));
  const [existing] = await sql`SELECT key, revision, generated_at FROM reports WHERE kind = 'daily' AND key = ${window.key}`;
  return { ...window, existing: existing ?? null, candidates: all.length, repeatsSuppressed: all.length - fresh.length,
    fresh: fresh.length, articles: fresh.map(a => ({ id: a.itemId, title: a.title, source: a.sourceName, score: a.score })),
    note: "Preview excludes backfill and the preceding seven editions; the existing composer also applies section size limits. No report written or model called." };
}

export async function generateRecentDaily(date?: string) {
  const preview = await dailyPreview(date);
  if (preview.existing) return { status: "already-present", report: preview.existing, modelCalls: 0 };
  if (!preview.fresh) return { status: "no-eligible-content", key: preview.key, modelCalls: 0 };
  const result = await composeDaily(preview.key, "bounded-local-recent-trial");
  const usage = await sql`SELECT id, purpose, model, usage, cost, currency, cost_basis FROM receipts WHERE subject = ${`report:daily:${preview.key}`} ORDER BY id`;
  return { status: "generated", ...result, receiptUsage: usage };
}

export async function publishRecent(ids: string[]) {
  if (!ids.length || ids.length > 3 || new Set(ids).size !== ids.length) throw new Error("Publish 1–3 distinct reviewed ids");
  const rows = await recentRows();
  for (const id of ids) {
    const a = rows.find(a => a.id === id);
    if (!a || a.input_revision !== a.revision || a.relevance !== "pass" || !/[\u3400-\u9fff]/.test(a.title_zh ?? "") || !/[\u3400-\u9fff]/.test(a.summary_zh ?? "")) throw new Error(`No current, relevant Chinese analysis: ${id}`);
    if (damagedCopy([a.title_zh, a.summary_zh, a.tags])) throw new Error(`Encoding damage: ${id}`);
  }
  return sql.begin(async tx => {
    const results = [];
    for (const id of ids) {
      const [a] = await tx`SELECT revision, backfill, published_at, discovered_at FROM articles WHERE id = ${id} FOR UPDATE`;
      assertRecent(a!);
      const [n] = await tx`SELECT id FROM analyses WHERE article_id = ${id} ORDER BY input_revision DESC, id DESC LIMIT 1`;
      const reviewed = rows.find(a => a.id === id)!;
      if (a!.revision !== reviewed.revision || n?.id !== reviewed.analysis_id) throw new Error("Article changed during publication; review again");
      const result = await publishArticleTx(tx, id);
      const [p] = await tx`SELECT title, summary, tags, selected, visibility, eligible FROM publications WHERE article_id = ${id}`;
      if (!p?.eligible || p.visibility !== "public" || p.selected !== reviewed.selected || !/[\u3400-\u9fff]/.test(p.title ?? "") || !/[\u3400-\u9fff]/.test(p.summary ?? "") || damagedCopy([p.title, p.summary, p.tags])) throw new Error("Public projection differs from reviewed selection or contains damaged copy; entire batch rolled back");
      results.push(result);
    }
    return results;
  });
}

export async function runRecent(args: string[]) {
  const options = recentOptions(args);
  recentValves(options.command);
  const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));
  if (options.command === "status") { print(await recentStatus()); return; }
  if (options.command === "daily-preview") { print(await dailyPreview(options.date)); return; }
  // One manual trial at a time. Network calls do not hold a database transaction.
  const connection = await sql.reserve();
  let locked = false;
  try {
    const [lock] = await connection`SELECT pg_try_advisory_lock(hashtext('agent-eval-recent-trial')) AS locked`;
    locked = lock!.locked;
    if (!locked) throw new Error("Another recent trial is running");
    if (options.command === "daily") { print(await generateRecentDaily(options.date)); return; }
    if (options.command === "collect") {
      for (const id of options.sources) {
        const [source] = await sql`SELECT enabled, participation_mode, next_fetch_at FROM sources WHERE id = ${id}`;
        if (!source || !source.enabled || source.participation_mode !== "editorial") { print({ sourceId: id, status: "skipped", reason: "missing-paused-or-not-editorial" }); continue; }
        if (source.next_fetch_at && source.next_fetch_at > new Date()) { print({ sourceId: id, status: "skipped", reason: "not-due", nextFetchAt: source.next_fetch_at }); continue; }
        const result = await collectSource(id); // No force: respect disabled sources and normal ingest caps.
        print({ ...result, modelCalls: 0 });
        if (result.status === "failed") throw new Error("Source failed; batch stopped. Inspect source health before retrying; do not repeatedly retry HTTP 429.");
      }
      print(await recentStatus());
      return;
    }
    if (options.command === "publish") { print({ results: await publishRecent(options.ids), modelCalls: 0 }); return; }
    const rows = await recentRows();
    const chosen = options.ids.map(id => {
      const a = rows.find(a => a.id === id);
      if (!a) throw new Error(`Not a recent eligible article: ${id}`);
      assertRecent(a);
      if (options.command === "analyze" && a.body_status !== "ok") throw new Error(`Body unavailable; extract before any model call: ${id}`);
      return a;
    });
    for (const a of chosen) {
      if (options.command === "extract") { print({ id: a.id, extraction: await extractArticleBody(a.id, false), modelCalls: 0 }); continue; }
      if (a.input_revision === a.revision) { print({ id: a.id, status: "already-analyzed", analysisId: a.analysis_id }); continue; }
      const result = await analyzeArticle(a.id); // Existing receipts/budgets, no forced attempt tag or auto-publication.
      print({ articleId: a.id, result });
      if (!result || result.stale || result.needsBody || !result.output || result.output.relevance === "unknown") throw new Error("Incomplete analysis; batch stopped before publication");
      if (result.receiptIds.length) print({ receiptUsage: await sql`SELECT id, purpose, model, usage, cost, currency, cost_basis FROM receipts WHERE id IN ${sql(result.receiptIds)}` });
    }
    print({ published: 0, note: "Review title, summary, category, evidence tags and selection before publish. Null receipt cost means unknown; check provider billing." });
  } finally {
    try { if (locked) await connection`SELECT pg_advisory_unlock(hashtext('agent-eval-recent-trial'))`; }
    finally { connection.release(); }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await runRecent(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "Recent trial failed"); process.exitCode = 1; }
  finally { await stopBoss(); await closeDb(); }
}
