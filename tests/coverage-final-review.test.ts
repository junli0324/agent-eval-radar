import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "@aihot/backend/lib/ids";
import { validateReviewedAnalysis, validateReviewPlan, reviewedPlan, finalReviews } from "../industry/v0.1/publish-coverage-final.ts";

test("publication review rejects changed analysis, stale inputs and selection overrides", () => {
  const a = { revision: 1, input_revision: 1, relevance: "pass", title_zh: "中文标题", summary_zh: "已审核摘要", tags: ["评测方法"] };
  const spec = { url: "https://example.org", analysisHash: sha256(JSON.stringify([a.title_zh, a.summary_zh, a.tags])), fields: { category: "methods" } };
  validateReviewedAnalysis(a, spec);
  assert.throws(() => validateReviewedAnalysis({ ...a, summary_zh: "Different new result" }, spec), /differs/);
  assert.throws(() => validateReviewedAnalysis({ ...a, revision: 2 }, spec), /differs/);
  assert.throws(() => validateReviewedAnalysis({ ...a, relevance: "block" }, spec), /differs/);
  assert.throws(() => validateReviewedAnalysis(a, { ...spec, fields: { selected: true } }), /Only/);
  for (const plan of finalReviews) assert.equal("selected" in plan.fields || "score" in plan.fields, false);
});

test("review batches are bounded and category tags agree without changing selection", () => {
  const october = reviewedPlan("october");
  assert.equal(october.length, 6);
  validateReviewPlan(october);
  validateReviewPlan(finalReviews);
  assert.throws(() => validateReviewPlan([]), /1–10/);
  assert.throws(() => validateReviewPlan([october[0]!, october[0]!]), /distinct/);
  assert.throws(() => validateReviewPlan([{ ...october[0]!, fields: { category: "methods", tags: ["实践观点"] } }]), /agree/);
  assert.throws(() => validateReviewPlan([{ ...october[0]!, fields: { ...october[0]!.fields, score: 99 } }]), /Only/);
});
