import { sql } from "../db.ts";

/** Issue metadata and a headline alone are not a published report body. Withdrawn citations remain
 * part of an issue's history; availability is handled by the existing citation projection. */
export function hasReportContent(content: Record<string, any>): boolean {
  return !!String(content.lead?.leadParagraph ?? "").trim() || !!String(content.overview ?? "").trim()
    || (content.sections ?? []).some((s: any) => s.items?.length)
    || (content.themes ?? []).some((t: any) => t.storyRefs?.length)
    || !!content.flashes?.length;
}

/** Same predicate for persisted, schema-shaped report content. Apply before LIMIT / latest / neighbors. */
export function reportContentSql(column = sql`content`) {
  return sql`(btrim(coalesce(${column} #>> '{lead,leadParagraph}', ''), E' \n\r\t') <> ''
    OR btrim(coalesce(${column}->>'overview', ''), E' \n\r\t') <> ''
    OR jsonb_path_exists(${column}, '$.sections[*].items[*]')
    OR jsonb_path_exists(${column}, '$.themes[*].storyRefs[*]')
    OR jsonb_path_exists(${column}, '$.flashes[*]'))`;
}
