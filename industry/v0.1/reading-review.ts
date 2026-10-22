// Explicit archival weekly reading issue, assembled from already public summaries. Zero model calls.
import { fileURLToPath } from "node:url";
import { addDays, beijingDate, beijingMidnight, isoWeekLabel, isoWeekRange } from "@aihot/contracts/time";
import { SITE } from "@aihot/industry/site";
import { CATEGORIES } from "@aihot/industry/taxonomy";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { loadArchiveReviewMaterials, type ArchiveReviewMaterial } from "@aihot/backend/publication/reports";
import { hasReportContent } from "@aihot/backend/publication/report-content";

export function reviewWindow(week: string | undefined = undefined, now = new Date()) {
  week ??= isoWeekLabel(addDays(beijingDate(now), -7));
  const range = isoWeekRange(week);
  if (!range) throw new Error("Use a valid ISO --week=YYYY-Www");
  const start = beijingMidnight(range.start);
  const end = beijingMidnight(addDays(range.end, 1));
  if (end > now) throw new Error("Reading review requires a completed week in Beijing time");
  return { week, start, end, periodStart: range.start, periodEnd: range.end };
}

export function readingContent(window: ReturnType<typeof reviewWindow>, rows: ArchiveReviewMaterial[]) {
  if (!rows.length || rows.length > 12) throw new Error("Reading issue requires 1–12 released materials");
  const themes = CATEGORIES.map(category => ({ heading: category.label, summary: "", storyRefs: rows
    .filter(r => r.category === category.key).map(({ publishedAt, category: _category, ...r }) => ({ ...r,
      publishedAt: publishedAt.toISOString(), factId: null, storyPublicId: null, role: r.firstParty ? "官方" : "来源" })) })).filter(t => t.storyRefs.length);
  if (themes.reduce((n, t) => n + t.storyRefs.length, 0) !== rows.length) throw new Error("Unrecognized material category; no reading issue saved");
  return { kind: "weekly", title: `${SITE.name} 资料回顾周报 · ${window.week}（补录）`, headline: `资料回顾 · ${window.week}（补录）`,
    isoLabel: window.week, periodStart: window.periodStart, periodEnd: window.periodEnd,
    overview: `本期为补录资料回顾，按原文发布日期整理 ${window.periodStart} 至 ${window.periodEnd} 的 ${rows.length} 篇已收录精选，不代表当周实时采集或今天新发布。以下复用本站已公开的中文摘要，未重新阅读论文全文或独立复现结果；请通过原文链接核对实验条件与作者结论。`,
    themes, storyOrder: rows.map(r => r.itemId), metrics: { totalStories: rows.length, selectedCount: rows.length },
    generator: { version: "archive-reading-v1", mode: "archive-review", model: null, materialScope: "published-summaries" } };
}

export async function readingReview(week: string | undefined, publish = false) {
  if (process.env.COLLECT_ENABLED !== "false" || process.env.MODEL_CALLS_ENABLED !== "false") throw new Error("Run with COLLECT_ENABLED=false and MODEL_CALLS_ENABLED=false");
  const window = reviewWindow(week);
  if (!publish) {
    const materials = await loadArchiveReviewMaterials(window.start, window.end);
    const [existing] = await sql`SELECT content FROM reports WHERE kind = 'weekly' AND key = ${window.week}`;
    return { status: "preview", ...window, materials: materials.map(r => ({ id: r.itemId, title: r.title, publishedAt: r.publishedAt })),
      entries: materials.length, existingReadable: !!existing && hasReportContent(existing.content), modelCalls: 0,
      note: "Explicit archival reading review, not a live-news edition. Up to twelve already released selected summaries, by original publication date." };
  }
  return sql.begin(async tx => {
    const [lock] = await tx`SELECT pg_try_advisory_xact_lock(hashtext(${`archive-reading:${window.week}`})) AS locked`;
    if (!lock!.locked) throw new Error("Another reading review is being published");
    const [existing] = await tx`SELECT id, content, revision, generated_at FROM reports WHERE kind = 'weekly' AND key = ${window.week} FOR UPDATE`;
    if (existing && hasReportContent(existing.content)) return { status: "already-present", key: window.week, modelCalls: 0 };
    const materials = await loadArchiveReviewMaterials(window.start, window.end, new Date(), tx);
    if (!materials.length) return { status: "no-eligible-materials", key: window.week, modelCalls: 0 };
    const content = readingContent(window, materials);
    if (existing) {
      await tx`INSERT INTO report_revisions (report_id, revision, content, generated_at, reason)
        VALUES (${existing.id}, ${existing.revision}, ${tx.json(existing.content)}, ${existing.generated_at}, 'Replace an empty placeholder with an explicitly labelled archival reading review') ON CONFLICT DO NOTHING`;
      await tx`UPDATE reports SET content = ${tx.json(content)}, window_start = ${window.start}, window_end = ${window.end},
        generated_at = now(), updated_at = now(), revision = revision + 1, model = NULL, origin = 'manual' WHERE id = ${existing.id}`;
    } else await tx`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at, origin)
      VALUES ('weekly', ${window.week}, ${window.start}, ${window.end}, ${tx.json(content)}, now(), 'manual')`;
    await tx`INSERT INTO audit_log (actor, action, subject, reason, after)
      VALUES ('local-reading-review', 'report.publish', ${`report:weekly:${window.week}`}, 'Assemble an explicitly labelled archival reading issue without model calls',
        ${tx.json({ itemIds: materials.map(r => r.itemId), mode: "archive-review" })})`;
    return { status: "published", key: window.week, entries: materials.length, modelCalls: 0, path: `/weekly/${window.week}` };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [command = "preview", option, ...extra] = process.argv.slice(2);
    if (!["preview", "publish"].includes(command) || (option && !/^--week=\d{4}-W\d{2}$/.test(option)) || extra.length) throw new Error("Use preview or publish [--week=YYYY-Www]");
    console.log(JSON.stringify(await readingReview(option?.slice(7), command === "publish"), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : "Reading review failed"); process.exitCode = 1; }
  finally { await stopBoss(); await closeDb(); }
}
