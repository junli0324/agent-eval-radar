// Bounded, resumable local-trial operations. Uses the existing ingest, receipts and publication paths.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { load } from "cheerio";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { analyzeArticle } from "@aihot/backend/editorial/analyze";
import { publishArticle } from "@aihot/backend/publication/publish";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { coverageCatalog, candidateUrl, candidateSourceId, ensureCoverageSource, parseCoveragePage, type Candidate } from "./coverage-materials.ts";

export const SOURCE_ID = "rss-arxiv-agent-eval";
export const COLLECTION = "agent-eval-trial-2026-10";
export const catalog: Candidate[] = JSON.parse(
  readFileSync(new URL("trial-catalog.json", import.meta.url), "utf8"));
const candidates = [...catalog, ...coverageCatalog];

export function parseOptions(args: string[]) {
  const command = args[0] ?? "status";
  if (!["catalog", "status", "overview", "import", "analyze", "publish"].includes(command)) throw new Error("Use catalog, status, overview, import, analyze or publish");
  let limit = 10;
  let ids: string[] = [];
  let set = "all";
  const seen = new Set<string>();
  for (const arg of args.slice(1)) {
    const key = arg.split("=")[0]!;
    if (seen.has(key)) throw new Error("Repeated option");
    seen.add(key);
    if (/^--limit=\d+$/.test(arg)) limit = Number(arg.slice(8));
    else if (/^--set=(base|coverage|all)$/.test(arg)) set = arg.slice(6);
    else if (/^--ids=[a-z0-9]+(?:,[a-z0-9]+)*$/.test(arg)) ids = [...new Set(arg.slice(6).split(","))];
    else throw new Error(`Unknown option: ${key}`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("Batch limit must be 1–10");
  if (command === "publish" && (!ids.length || ids.length > 10)) throw new Error("Publish requires --ids=... (1–10 reviewed article ids)");
  if (command !== "publish" && ids.length) throw new Error("--ids is only for publish");
  if (seen.has("--limit") && !["import", "analyze"].includes(command)) throw new Error("--limit is only for import/analyze");
  return { command, limit, ids, set };
}

/** Read only the publisher's abstract, not navigation, comments, linked documents or an invented full paper. */
export function parseArxivAbstract(html: string, expectedId: string) {
  const $ = load(html);
  const meta = (key: string) => $(`meta[name="${key}"]`).attr("content")?.trim() ?? "";
  const pageId = meta("citation_arxiv_id").replace(/v\d+$/, "");
  if (pageId !== expectedId) throw new Error("arXiv identity missing or mismatched");
  const title = meta("citation_title");
  const abstract = $("blockquote.abstract").clone();
  abstract.find(".descriptor, script, style").remove();
  const text = abstract.text().replace(/\s+/g, " ").trim();
  const dateText = meta("citation_date").replaceAll("/", "-");
  const publishedAt = new Date(`${dateText}T00:00:00Z`);
  if (!title || text.length < 200 || !/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !Number.isFinite(publishedAt.getTime()) || publishedAt.toISOString().slice(0, 10) !== dateText) {
    throw new Error("Missing title, abstract or valid publication date; nothing imported");
  }
  if (publishedAt.getTime() > Date.now()) throw new Error("Future publication date; review manually");
  const authors = $('meta[name="citation_author"]').map((_, e) => $(e).attr("content") ?? "").get().join(", ");
  return { title, publishedAt, author: authors || null,
    bodyText: `【材料范围：论文摘要，非全文；以下结果为作者在论文中报告，不代表独立复现或当前榜单。】\n${text}`,
    version: meta("citation_arxiv_id") };
}

async function ensureSource() {
  const [s] = await sql`SELECT kind, participation_mode, site_fulltext, syndicate_fulltext FROM sources WHERE id = ${SOURCE_ID}`;
  if (!s || s.participation_mode !== "editorial" || s.site_fulltext || s.syndicate_fulltext) {
    throw new Error("Expected the existing editorial arXiv source with full-text display off; review source settings first");
  }
}

export async function importAbstract(id: string, html: string) {
  const entry = candidates.find(c => c.id === id && !c.url);
  if (!entry) throw new Error("Not in reviewed trial catalog");
  await ensureSource();
  const parsed = parseArxivAbstract(html, id);
  return upsertMaterial({ sourceId: SOURCE_ID, url: `https://arxiv.org/abs/${id}`, ...parsed,
    bodyStatus: "ok", language: "en", via: "import", backfill: COLLECTION,
    raw: { trialCollection: COLLECTION, trialSet: coverageCatalog.includes(entry) ? "coverage" : "base", arxivVersion: parsed.version, materialScope: "abstract", datePrecision: "day" } });
}

export async function importCoveragePage(entry: Candidate, html: string, finalUrl: string) {
  if (!coverageCatalog.includes(entry) || !entry.url) throw new Error("Not in reviewed coverage catalog");
  const parsed = parseCoveragePage(html, entry, finalUrl);
  await ensureCoverageSource(entry);
  return upsertMaterial({ sourceId: candidateSourceId(entry), url: entry.url, title: parsed.title,
    publishedAt: parsed.publishedAt, bodyText: parsed.bodyText, bodyStatus: "ok", language: "en", via: "import", backfill: COLLECTION,
    raw: { trialCollection: COLLECTION, trialSet: "coverage", materialScope: parsed.materialScope,
      retrievedAt: new Date().toISOString(), publicationDateKnown: parsed.publishedAt !== null } });
}

export async function trialRows(set = "all") {
  return sql`SELECT a.id, a.title, a.url, a.published_at, a.revision, a.body_status,
    length(a.body_text) AS body_chars, a.raw->>'arxivVersion' AS arxiv_version,
    coalesce(a.raw->>'trialSet', 'base') AS trial_set, a.raw->>'materialScope' AS material_scope,
    n.id AS analysis_id, n.input_revision, n.relevance, n.selected, n.score,
    n.title_zh, n.summary_zh, n.tags, n.reason_zh,
    p.eligible, p.visible_after, p.updated_at AS published_updated_at,
    p.title AS public_title, p.summary AS public_summary, p.tags AS public_tags,
    p.category AS public_category, p.selected AS public_selected, p.visibility AS public_visibility
    FROM articles a
    LEFT JOIN LATERAL (SELECT * FROM analyses WHERE article_id = a.id ORDER BY input_revision DESC, id DESC LIMIT 1) n ON true
    LEFT JOIN publications p ON p.article_id = a.id
    WHERE a.raw->>'trialCollection' = ${COLLECTION}
      AND (${set} = 'all' OR coalesce(a.raw->>'trialSet', 'base') = ${set})
    ORDER BY a.discovered_at, a.id`;
}

export async function trialOverview(set = "all") {
  const rows = await trialRows(set);
  const published = rows.filter(a => a.eligible && a.public_visibility === "public");
  const categories: Record<string, number> = {};
  for (const a of published) categories[a.public_category ?? "uncategorized"] = (categories[a.public_category ?? "uncategorized"] ?? 0) + 1;
  return { set, imported: rows.length, analyzed: rows.filter(a => a.input_revision === a.revision).length,
    published: published.length, selectedReleased: published.filter(a => a.public_selected && a.visible_after && new Date(a.visible_after).getTime() <= Date.now()).length,
    categories, pending: rows.filter(a => !a.eligible || a.public_visibility !== "public").map(a => ({ id: a.id, title: a.title, analyzed: a.input_revision === a.revision, relevance: a.relevance })) };
}

export async function publishReviewed(ids: string[]) {
  if (!ids.length || ids.length > 10) throw new Error("Review 1–10 article ids per publication batch");
  const rows = await trialRows();
  // Validate the whole batch before any publication. Do not override relevance, selected, tags or score.
  for (const id of ids) {
    const a = rows.find(r => r.id === id);
    if (!a || a.input_revision !== a.revision || a.relevance !== "pass" || !a.title_zh?.trim() || !a.summary_zh?.trim()) {
      throw new Error(`Not a current, relevant, reviewed trial candidate: ${id}`);
    }
  }
  const results = [];
  for (const id of ids) results.push(await publishArticle(id));
  return results;
}

export async function runTrial(args: string[]) {
  const { command, limit, ids, set } = parseOptions(args);
  const entries = set === "coverage" ? coverageCatalog : set === "base" || command === "import" ? catalog : candidates;
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  if (command === "catalog") { print(entries.map(c => ({ ...c, url: candidateUrl(c) }))); return; }
  await ensureSource();
  if (command === "status") { print(await trialRows(set)); return; }
  if (command === "overview") { print(await trialOverview(set)); return; }
  if (command === "analyze" && process.env.MODEL_CALLS_ENABLED !== "true") throw new Error("Analyze requires explicit MODEL_CALLS_ENABLED=true for this process");
  if (command !== "analyze" && process.env.MODEL_CALLS_ENABLED !== "false") throw new Error("Import/publish require MODEL_CALLS_ENABLED=false");
  if (command === "import" && process.env.COLLECT_ENABLED !== "true") throw new Error("Import requires explicit COLLECT_ENABLED=true");
  // One session lock prevents overlapping manual batches; no database transaction spans HTTP calls.
  const connection = await sql.reserve();
  let locked = false;
  try {
    const [lock] = await connection`SELECT pg_try_advisory_lock(hashtext(${COLLECTION})) AS locked`;
    locked = lock!.locked;
    if (!locked) throw new Error("Another trial batch is running");
    if (command === "import") {
      let fetched = 0;
      for (const entry of entries) {
        if (fetched >= limit) break;
        // arXiv RSS often uses http and a version suffix. Do not duplicate those existing materials.
        const pattern = `^https?://(export[.])?arxiv[.]org/(abs|pdf)/${entry.id.replace('.', '[.]')}(v[0-9]+)?([.]pdf)?([?#].*)?$`;
        const [existing] = entry.url
          ? await sql`SELECT id FROM articles WHERE url = ${entry.url} LIMIT 1`
          : await sql`SELECT id FROM articles WHERE url ~ ${pattern} LIMIT 1`;
        if (existing) { print({ name: entry.name, status: "already-present", articleId: existing.id }); continue; }
        if (fetched > 0) await delay(3500);
        fetched++;
        const response = await guardedFetch(candidateUrl(entry), { timeoutMs: 25_000, maxBytes: 6 * 1024 * 1024 });
        if (response.status !== 200) throw new Error(`Publisher HTTP ${response.status}; batch stopped, imported articles retained; do not repeatedly retry a 429`);
        if (!response.headers.get("content-type")?.includes("text/html")) throw new Error("Expected publisher HTML");
        const result = entry.url ? await importCoveragePage(entry, response.text(), response.url) : await importAbstract(entry.id, response.text());
        print({ name: entry.name, ...result, modelCalls: 0 });
      }
      print({ fetched, modelCalls: 0 });
    } else if (command === "analyze") {
      const rows = (await trialRows(set)).filter(a => a.body_status === "ok" && a.body_chars && a.input_revision !== a.revision).slice(0, limit);
      for (const a of rows) {
        const result = await analyzeArticle(a.id); // stable receipt keys: resuming never forces a fresh attempt tag
        print({ articleId: a.id, title: a.title, result });
        if (!result || result.stale || result.needsBody) throw new Error("Analysis incomplete; batch stopped before publication");
        if (result.receiptIds.length) {
          const usage = await sql`SELECT id, model, purpose, usage, cost, currency, cost_basis FROM receipts WHERE id IN ${sql(result.receiptIds)}`;
          print({ articleId: a.id, receiptUsage: usage, note: "Receipt totals can include cached historical calls; null cost is unknown, not zero. Check provider billing." });
        }
      }
      print({ analyzed: rows.length, published: 0 });
    } else print(await publishReviewed(ids));
  } finally {
    try { if (locked) await connection`SELECT pg_advisory_unlock(hashtext(${COLLECTION}))`; }
    finally { connection.release(); }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await runTrial(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "Trial operation failed"); process.exitCode = 1; }
  finally { await stopBoss(); await closeDb(); }
}
