import assert from "node:assert/strict";
import { test } from "node:test";
import { hasEncodingDamage, repairedFields, reviewRepairs } from "../industry/v0.1/repair-review-encoding.ts";

const asciiLoss = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/[^\x00-\x7f]/g, "?"));
test("every reviewed payload survives repair after simulated PowerShell ASCII loss", () => {
  for (const spec of reviewRepairs) {
    const damaged = asciiLoss(spec.fields);
    assert.ok(Object.values(damaged).some(hasEncodingDamage));
    assert.deepEqual(repairedFields(damaged, spec), spec.fields);
    assert.deepEqual(repairedFields(spec.fields, spec), spec.fields);
  }
});

test("repair preserves clean custom edits and selection, and refuses unknown damaged fields", () => {
  const spec = reviewRepairs.find(r => r.url.includes("core-concepts"))!;
  const before = { summary: "人工写好的不同摘要", selected: false, category: "tools", tags: ["????", "???"] };
  const next = repairedFields(before, spec);
  assert.equal(next.summary, before.summary);
  assert.equal(next.selected, false);
  assert.equal(next.category, "tools");
  assert.deepEqual(next.tags, spec.fields.tags);
  assert.throws(() => repairedFields({ unknown: "???" }, spec), /Unrecognized/);
});
