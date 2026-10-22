// Explicit one-off reading list; these sources are never scheduled by this script.
import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { readable } from "@aihot/backend/content/extract";
import { sql } from "@aihot/backend/db";

export interface Candidate {
  id: string; name: string; focus: string; expectedCategory?: string;
  url?: string; source?: string; kind?: "article" | "docs";
}
export const coverageCatalog: Candidate[] = JSON.parse(readFileSync(new URL("coverage-catalog.json", import.meta.url), "utf8"));
const sources: Record<string, { name: string; hosts: string[]; owner: string | null }> = {
  anthropic: { name: "Anthropic · Agent 评测资料", hosts: ["www.anthropic.com"], owner: "anthropic" },
  harbor: { name: "Harbor · 官方文档", hosts: ["docs.harborframework.com"], owner: null },
  "inspect-cyber": { name: "Inspect Cyber · 官方文档", hosts: ["inspect.cyber.aisi.org.uk"], owner: null },
  langchain: { name: "LangChain · Agent 评测资料", hosts: ["docs.langchain.com", "www.langchain.com"], owner: null },
};
export const candidateUrl = (c: Candidate) => c.url ?? `https://arxiv.org/abs/${c.id}`;
export const candidateSourceId = (c: Candidate) => c.url ? `trial-${c.source}` : "rss-arxiv-agent-eval";

function normalizedUrl(url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.username || u.password) throw new Error("Expected an HTTPS publisher URL");
  u.hash = ""; u.search = "";
  return u.href.replace(/\/$/, "");
}

/** Reject a redirected home page or unrelated canonical before reading its body. */
export function parseCoveragePage(html: string, entry: Candidate, finalUrl: string, retrievedAt = new Date()) {
  const source = entry.source && sources[entry.source];
  if (!entry.url || !source || !source.hosts.includes(new URL(entry.url).hostname)) throw new Error("Unreviewed publisher URL");
  if (normalizedUrl(finalUrl) !== normalizedUrl(entry.url)) throw new Error("Publisher redirected to a different document");
  const $ = load(html);
  const title = $("h1").first().text().replace(/\s+/g, " ").trim();
  if (!title) throw new Error("Publisher title missing");
  const identity = $('link[rel="canonical"]').attr("href") ?? $('meta[property="og:url"]').attr("content");
  if (identity ? normalizedUrl(new URL(identity, finalUrl).href) !== normalizedUrl(entry.url)
    : entry.kind !== "docs" || title !== entry.name) throw new Error("Publisher document identity missing or mismatched");
  const root = ($("article").first().length ? $("article").first() : $("main").first()).clone();
  if (!root.length) throw new Error("Publisher article/main content missing");
  root.find('nav, header, footer, aside, script, style, form, [role="navigation"]').remove();
  const body = readable(`<html><head><title>${title.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</title></head><body><article>${root.html()}</article></body></html>`, finalUrl);
  if (!body || body.text.length < 500) throw new Error("Publisher body unavailable or too short");
  let dateText = $('meta[property="article:published_time"]').attr("content") ?? "";
  if (!dateText) dateText = $("time[datetime]").first().attr("datetime") ?? "";
  // Publisher JSON-LD is data, never executable code. Only publication dates count (not modified dates).
  if (!dateText) {
    const dates: string[] = [];
    const visit = (v: unknown) => {
      if (Array.isArray(v)) { v.forEach(visit); return; }
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (typeof o.datePublished === "string") dates.push(o.datePublished);
        if (o["@graph"]) visit(o["@graph"]);
      }
    };
    $('script[type="application/ld+json"]').each((_, e) => { try { visit(JSON.parse($(e).text())); } catch { /* Ignore malformed unrelated metadata. */ } });
    dateText = dates[0] ?? "";
  }
  let publishedAt: Date | null = null;
  if (entry.kind !== "docs") {
    publishedAt = new Date(dateText);
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(dateText) || !Number.isFinite(publishedAt.getTime()) || publishedAt.toISOString().slice(0, 10) !== dateText.slice(0, 10) || publishedAt > retrievedAt) throw new Error("Valid publisher publication date missing; no guessed date imported");
  }
  const scope = entry.kind === "docs"
    ? `【材料范围：官方工具文档快照，抓取日期 ${retrievedAt.toISOString().slice(0, 10)}；首次发布日期未知，不是工具今天新发布。功能可能随文档更新。】`
    : "【材料范围：官方文章正文；成绩与结论为作者报告，受原文时间、版本和实验设置限制，不代表独立复现或当前榜单。】";
  return { title: entry.kind === "docs" ? `${title}（官方文档快照）` : title, publishedAt,
    bodyText: `${scope}\n${body.text}`, materialScope: entry.kind === "docs" ? "documentation-snapshot" : "publisher-article" };
}

export async function ensureCoverageSource(entry: Candidate) {
  const s = entry.source && sources[entry.source];
  if (!s || !entry.url || !s.hosts.includes(new URL(entry.url).hostname)) throw new Error("Unreviewed publisher source");
  const id = candidateSourceId(entry);
  await sql`INSERT INTO sources (id, name, kind, tier, first_party, owner_entity_id, participation_mode, site_fulltext, syndicate_fulltext, enabled, imported_from)
    VALUES (${id}, ${s.name}, 'external', 'T1_5', true, ${s.owner}, 'editorial', false, false, false, 'agent-eval-coverage-trial')
    ON CONFLICT (id) DO NOTHING`;
  const [existing] = await sql`SELECT participation_mode, site_fulltext, syndicate_fulltext, kind, imported_from FROM sources WHERE id = ${id}`;
  if (!existing || existing.kind !== "external" || existing.imported_from !== "agent-eval-coverage-trial" || existing.participation_mode !== "editorial" || existing.site_fulltext || existing.syndicate_fulltext) throw new Error("Existing source settings differ; left unchanged for manual review");
}
