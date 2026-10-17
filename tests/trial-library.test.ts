import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog, parseArxivAbstract, parseOptions } from "../industry/v0.1/trial-library.ts";

const abstract = "We evaluate agents interacting with a reproducible environment. Tasks require planning, tool calls and checking the final state. Success is verified against task-specific criteria, and repeated runs measure reliability. These are author-reported results.";
const page = (id = "2404.07972v2", date = "2024/04/11") => `<meta name="citation_arxiv_id" content="${id}"><meta name="citation_title" content="Agent evaluation"><meta name="citation_date" content="${date}"><nav>Unrelated navigation</nav><blockquote class="abstract"><span class="descriptor">Abstract:</span>${abstract}<script>bad()</script></blockquote>`;

test("abstract import checks identity and preserves source date without importing navigation", () => {
  const parsed = parseArxivAbstract(page(), "2404.07972");
  assert.equal(parsed.publishedAt.toISOString(), "2024-04-11T00:00:00.000Z");
  assert.ok(parsed.bodyText.endsWith(abstract));
  assert.match(parsed.bodyText, /论文摘要，非全文/);
  assert.doesNotMatch(parsed.bodyText, /Unrelated|bad\(\)|Abstract:/);
  assert.throws(() => parseArxivAbstract(page("2310.06770"), "2404.07972"), /identity/);
  assert.throws(() => parseArxivAbstract(page().replace(abstract, "Unavailable"), "2404.07972"), /Missing/);
  assert.throws(() => parseArxivAbstract(page(undefined, "2024/02/30"), "2404.07972"), /Missing/);
  assert.throws(() => parseArxivAbstract(page(undefined, "2099/01/01"), "2404.07972"), /Future/);
});

test("batch controls reject unbounded or ambiguous operations", () => {
  for (const args of [["analyze", "--limit=0"], ["import", "--limit=11"], ["analyze", "--limit=1", "--limit=2"], ["publish"], ["publish", "--ids=a", "--limit=1"], ["analyze", "--ids=a"]]) {
    assert.throws(() => parseOptions(args));
  }
  assert.deepEqual(parseOptions(["analyze", "--limit=3"]), { command: "analyze", limit: 3, ids: [] });
  assert.deepEqual(parseOptions(["publish", "--ids=abc,def,abc"]).ids, ["abc", "def"]);
  assert.equal(new Set(catalog.map(c => c.id)).size, catalog.length);
});
