import type { ContentUpdates } from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { listedCondition } from "./items.ts";
import { reportContentSql } from "./report-content.ts";

/** Public projection only. Revisions count as updates; pending releases and raw imports never do. */
export async function loadContentUpdates(since: Date | null, now = new Date()): Promise<ContentUpdates> {
  const start = new Date(+now - 30 * 86400000);
  const watermark = since ? new Date(Math.max(+since, +start)) : now;
  const [row] = await sql`WITH updates AS (
      SELECT 'article'::text AS kind, p.article_id AS key, p.title, '/items/' || p.article_id AS href,
        greatest(p.updated_at, CASE WHEN p.selected THEN p.visible_after ELSE p.updated_at END) AS at, p.selected
      FROM publications p WHERE ${listedCondition(now)} AND p.eligible
      UNION ALL
      SELECT kind, key, CASE kind WHEN 'daily' THEN '评测日报' WHEN 'weekly' THEN '评测周报' ELSE '评测月报' END || ' · ' || key,
        '/' || kind || '/' || key, generated_at, false
      FROM reports WHERE ${reportContentSql()}
    ), recent AS (SELECT * FROM updates WHERE at >= ${start} AND at <= ${now})
    SELECT count(*) FILTER (WHERE kind = 'article' AND at > ${watermark})::int AS articles,
      count(*) FILTER (WHERE kind <> 'article' AND at > ${watermark})::int AS reports,
      max(at) AS latest,
      coalesce((SELECT jsonb_agg(e ORDER BY e.at DESC, e.kind, e.key) FROM
        (SELECT * FROM recent ORDER BY at DESC, kind, key LIMIT 12) e), '[]'::jsonb) AS entries FROM recent`;
  return { checkedAt: now.toISOString(), since: since ? watermark.toISOString() : null,
    latestAt: row!.latest?.toISOString() ?? null, articles: row!.articles, reports: row!.reports,
    entries: row!.entries.map((e: ContentUpdates["entries"][number]) => ({ ...e, at: new Date(e.at).toISOString() })) };
}
