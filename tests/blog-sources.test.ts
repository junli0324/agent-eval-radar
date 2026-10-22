import assert from "node:assert/strict";
import { test } from "node:test";
import { BLOG_SOURCES } from "../industry/v0.1/blog-sources.ts";
import { fromHtml } from "@aihot/backend/sources/web-list";
import { noiseFiltered } from "@aihot/backend/sources/collect";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { recentOptions } from "../industry/v0.1/recent-policy.ts";
import { coverageCatalog } from "../industry/v0.1/coverage-materials.ts";

test("official blog selectors read dated article cards and the title filter rejects generic news", () => {
  const html = [
    '<nav><a href="/blog/evaluation">Evaluation navigation</a></nav>',
    '<div class="blog-item"><h2>Evaluating tool agents</h2><div class="date-color">October 15, 2026</div><a class="blog-link-absolute" href="/blog/tool-evals"></a></div>',
    '<div class="blog-item"><h2>New product partnership</h2><div class="date-color">October 16, 2026</div><a class="blog-link-absolute" href="/blog/partnership"></a></div>',
  ].join("");
  const langchain = BLOG_SOURCES[0]!;
  const rows = fromHtml(html, langchain.config.url, langchain).filter(c => !noiseFiltered(c, langchain));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.title, "Evaluating tool agents");
  assert.equal(rows[0]!.publishedAt!.toISOString(), "2026-10-15T00:00:00.000Z");
  const anthropic = BLOG_SOURCES[1]!;
  const research = '<a class="PublicationList-module__listItem" href="/research/agent-evals"><time>Oct 9, 2026</time><span class="PublicationList-module__title">Investigating unintended model actions in our evaluations</span></a><a href="/research">All research</a>';
  const papers = fromHtml(research, anthropic.config.url, anthropic);
  assert.equal(papers.length, 1);
  assert.equal(papers[0]!.publishedAt!.toISOString(), "2026-10-09T00:00:00.000Z");
  assert.equal(noiseFiltered(papers[0]!, anthropic), false);
  // The new listing puts a team link and thumbnail before the actual title link.
  // Match dated article rows, not hero tiles/navigation; duplicate layout cards keep one identity.
  const card = `<article data-listing-row="article-11ebf016"><header><p><a href="/research/team/alignment">Alignment</a></p><time>Oct 9, 2026</time></header>
    <figure><a href="/research/wrong-thumbnail">Image</a></figure><div><h3><a href="/research/investigating-unintended-model-actions">Investigating unintended model actions in our evaluations and internal use</a></h3><p>This report describes observed behavior.</p></div></article>`;
  const newListing = `<nav><a href="/research/team/alignment">Alignment</a></nav>${card}${card}
    <article data-listing-row="article-generic"><time>Oct 16, 2026</time><h3><a href="/research/employment">How employment is changing</a></h3></article>`;
  const dated = fromHtml(newListing, anthropic.config.url, anthropic);
  assert.equal(dated.length, 2);
  const relevant = dated.filter(c => !noiseFiltered(c, anthropic));
  assert.equal(relevant.length, 1);
  assert.equal(relevant[0]!.url, "https://www.anthropic.com/research/investigating-unintended-model-actions");
  assert.equal(relevant[0]!.title, "Investigating unintended model actions in our evaluations and internal use");
  assert.equal(relevant[0]!.publishedAt!.toISOString(), "2026-10-09T00:00:00.000Z");
  for (const source of BLOG_SOURCES) assert.deepEqual(unsupportedConfig(source.kind, source.config), []);
  assert.equal(recentOptions(["collect", "--sources=web-langchain-blog,web-anthropic-research"]).sources.length, 2);
});

test("October reading candidates retain primary identities without preselecting content", () => {
  const ids = ["2610.20424", "2610.21109", "2610.16067", "2610.07274", "2610.21074", "unintended-actions"];
  for (const id of ids) {
    const c = coverageCatalog.find(c => c.id === id)!;
    assert.ok(c?.name && c.focus);
    assert.equal("selected" in c || "score" in c || "publishedAt" in c, false);
  }
  assert.equal(new Set(coverageCatalog.map(c => c.id)).size, coverageCatalog.length);
});
