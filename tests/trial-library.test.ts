import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog, parseArxivAbstract, parseOptions } from "../industry/v0.1/trial-library.ts";
import { coverageCatalog, parseCoveragePage } from "../industry/v0.1/coverage-materials.ts";

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
  assert.deepEqual(parseOptions(["analyze", "--limit=3"]), { command: "analyze", limit: 3, ids: [], set: "all" });
  assert.equal(parseOptions(["import", "--set=coverage"]).set, "coverage");
  assert.throws(() => parseOptions(["import", "--set=unreviewed"]));
  assert.deepEqual(parseOptions(["publish", "--ids=abc,def,abc"]).ids, ["abc", "def"]);
  assert.equal(new Set(catalog.map(c => c.id)).size, catalog.length);
});

test("publisher import rejects mismatched documents and unknown publication dates", () => {
  const entry = coverageCatalog.find(c => c.id === "demystifying-evals")!;
  const body = "Agents call tools and modify environments. We evaluate the task outcome against observable state and inspect trajectories for failures. ".repeat(10);
  const page = `<html><head><link rel="canonical" href="${entry.url}"><script type="application/ld+json">{"@type":"Article","datePublished":"2026-01-09T00:00:00Z"}</script></head><body><main><h1>Agent evaluations</h1><nav>Navigation only</nav><p>${body}</p></main></body></html>`;
  const parsed = parseCoveragePage(page, entry, entry.url!);
  assert.equal(parsed.publishedAt!.toISOString(), "2026-01-09T00:00:00.000Z");
  assert.doesNotMatch(parsed.bodyText, /Navigation only/);
  assert.throws(() => parseCoveragePage(page, entry, "https://www.anthropic.com/"), /different document/);
  assert.throws(() => parseCoveragePage(page.replace(entry.url!, "https://www.anthropic.com/"), entry, entry.url!), /identity/);
  assert.throws(() => parseCoveragePage(page.replace("datePublished", "dateModified"), entry, entry.url!), /publication date/);
  assert.throws(() => parseCoveragePage(page.replace("2026-01-09", "2026-02-30"), entry, entry.url!), /publication date/);
  const doc = coverageCatalog.find(c => c.id === "inspect-cyber-docs")!;
  const docPage = page.replace(/<link[^>]+>/, "").replace("Agent evaluations", doc.name);
  const snapshot = parseCoveragePage(docPage, doc, doc.url!);
  assert.equal(snapshot.publishedAt, null, "a document date must not become a launch date");
  assert.match(snapshot.title, /官方文档快照/);
  assert.match(snapshot.bodyText, /首次发布日期未知/);
  assert.throws(() => parseCoveragePage(docPage.replace(doc.name, "Not the expected doc"), doc, doc.url!), /identity/);
});
