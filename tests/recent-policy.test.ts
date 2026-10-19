import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRecent, dailyWindow, recentOptions, recentValves, damagedCopy } from "../industry/v0.1/recent-policy.ts";

test("recent operations require explicit bounded targets and matching process valves", () => {
  assert.deepEqual(recentOptions([]).ids, []);
  assert.throws(() => recentOptions(["analyze"]), /1–3/);
  assert.throws(() => recentOptions(["analyze", "--ids=a,b,c,d"]), /1–3/);
  assert.throws(() => recentOptions(["status", "--ids=a"]), /ids/);
  assert.throws(() => recentOptions(["collect", "--sources=rss-arxiv-agent-eval"]), /allowlist/);
  assert.throws(() => recentOptions(["collect", "--sources=rss-inspect-ai", "--sources=rss-tau2-bench"]), /Repeated/);
  assert.throws(() => recentOptions(["daily", "--date=2026-02-30"]), /valid/);
  assert.throws(() => recentOptions(["status", "--date=2026-01-01"]), /only/);
  assert.equal(recentOptions(["analyze", "--ids=a,b"]).ids.length, 2);
  recentValves("status", { COLLECT_ENABLED: "false", MODEL_CALLS_ENABLED: "false" });
  recentValves("collect", { COLLECT_ENABLED: "true", MODEL_CALLS_ENABLED: "false" });
  recentValves("analyze", { COLLECT_ENABLED: "false", MODEL_CALLS_ENABLED: "true" });
  assert.throws(() => recentValves("publish", { COLLECT_ENABLED: "false", MODEL_CALLS_ENABLED: "true" }), /MODEL_CALLS_ENABLED=false/);
  assert.throws(() => recentValves("daily", { COLLECT_ENABLED: "true", MODEL_CALLS_ENABLED: "true" }), /COLLECT_ENABLED=false/);
});

test("daily defaults to the last closed Beijing 08:00 window across month/year boundaries", () => {
  const before = dailyWindow(undefined, new Date("2026-01-01T07:59:59+08:00"));
  assert.equal(before.key, "2025-12-31");
  assert.equal(before.end.toISOString(), "2025-12-31T00:00:00.000Z");
  const after = dailyWindow(undefined, new Date("2026-01-01T08:00:00+08:00"));
  assert.equal(after.key, "2026-01-01");
  assert.equal(after.start.toISOString(), "2025-12-31T00:00:00.000Z");
  assert.throws(() => dailyWindow("2026-01-01", new Date("2026-01-01T07:59:59+08:00")), /not closed/);
  assert.throws(() => dailyWindow("2026-02-30"), /valid/);
});

test("recent eligibility rejects archived, undated, old and future materials", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const a = { backfill: false, published_at: new Date("2026-10-18T12:00:00Z"), discovered_at: now };
  assertRecent(a, now);
  assert.throws(() => assertRecent({ ...a, backfill: true }, now), /non-backfill/);
  assert.throws(() => assertRecent({ ...a, published_at: null }, now), /dated/);
  assert.throws(() => assertRecent({ ...a, published_at: new Date("2026-10-01") }, now), /14 days/);
  assert.throws(() => assertRecent({ ...a, published_at: new Date("2026-10-20") }, now), /14 days/);
  assert.equal(damagedCopy(["正常中文", ["Harbor ???"]]), true);
  assert.equal(damagedCopy(["中文摘要", "Pass@k"]), false);
});
