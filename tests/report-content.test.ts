import assert from "node:assert/strict";
import { test } from "node:test";
import { hasReportContent } from "@aihot/backend/publication/report-content";
import { readingContent, reviewWindow } from "../industry/v0.1/reading-review.ts";

test("report metadata alone is empty; prose and citation history remain readable", () => {
  assert.equal(hasReportContent({ title: "Empty weekly", headline: "A heading", sections: [], themes: [], flashes: [], overview: " \n\t" }), false);
  for (const content of [{ overview: "A review" }, { lead: { leadParagraph: "Daily prose" } }, { flashes: [{ title: "A flash" }] },
    { sections: [{ items: [{ itemId: "withdrawn-later", title: "Original citation" }] }] }, { themes: [{ storyRefs: [{ title: "A reference" }] }] }]) assert.equal(hasReportContent(content), true);
});

test("archival reading issue states its scope and preserves the exact public summaries and original dates", () => {
  const window = reviewWindow("2026-W42", new Date("2026-10-19T12:00:00Z"));
  assert.equal(window.periodStart, "2026-10-12"); assert.equal(window.periodEnd, "2026-10-18");
  assert.throws(() => reviewWindow("2026-W43", new Date("2026-10-19T12:00:00Z")), /completed/);
  assert.throws(() => reviewWindow("2026-W99"), /valid/);
  const source = { itemId: "a", title: "论文原有中文标题", summary: "作者报告的中文摘要", category: "benchmarks", score: 76,
    sourceName: "arXiv", sourceUrl: "https://arxiv.org/abs/2610.20424", sourceId: "arxiv", firstParty: false, publishedAt: new Date("2026-10-14T00:00:00Z") };
  const issue = readingContent(window, [source]);
  assert.match(issue.headline, /补录/); assert.match(issue.overview, /不代表当周实时采集/);
  assert.equal(issue.themes[0]!.storyRefs[0]!.summary, source.summary);
  assert.equal(issue.themes[0]!.storyRefs[0]!.publishedAt, source.publishedAt.toISOString());
  assert.equal(issue.generator.model, null);
  assert.throws(() => readingContent(window, []), /1–12/);
});
