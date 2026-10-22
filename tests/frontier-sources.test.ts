import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import { FRONTIER_SOURCES } from "../industry/v0.1/frontier-catalog.ts";
import { RECENT_SOURCES } from "../industry/v0.1/recent-policy.ts";
import { noiseFiltered } from "@aihot/backend/sources/collect";
import { fetchRss } from "@aihot/backend/sources/rss";
import { fromHtml, allowed } from "@aihot/backend/sources/web-list";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { config } from "@aihot/backend/config";
import type { Candidate, SourceRow } from "@aihot/backend/sources/types";

const papers = FRONTIER_SOURCES[0]!;
const c = (title: string, excerpt = ""): Candidate => ({ url: "https://example.org/article", title, excerpt });
const description = "arXiv:2610.12345v1 Announce Type: new Abstract: We evaluate tool-using agents on stateful tasks and report benchmark evidence. ".repeat(4);
let endpoint: string;
const server = http.createServer((_req, res) => {
  res.setHeader("content-type", "application/rss+xml");
  res.end(`<rss version="2.0"><channel><title>Papers</title><item><title>Stateful Agent Evaluation</title><link>https://arxiv.org/abs/2610.12345</link>
    <pubDate>Thu, 22 Oct 2026 00:00:00 -0400</pubDate><description><![CDATA[${description}]]></description></item></channel></rss>`);
});
before(async () => { config.allowPrivateNetworkFetch = true; await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
after(async () => { config.allowPrivateNetworkFetch = false; await new Promise<void>(resolve => server.close(() => resolve())); });

test("discovery requires both Agent and evaluation evidence and only new arXiv announcements", () => {
  assert.equal(noiseFiltered(c("Stateful Agent Evaluation", "arXiv:2610.1v1 Announce Type: new Abstract: success criteria"), papers), false);
  for (const type of ["replace", "cross", "replace-cross", "new-cross"]) {
    assert.equal(noiseFiltered(c("Agent benchmark", `arXiv:1 Announce Type: ${type} Abstract: agent evaluation`), papers), true, type);
  }
  assert.equal(noiseFiltered(c("Agent product launch", "Announce Type: new Abstract: fundraising and users"), papers), true);
  assert.equal(noiseFiltered(c("Speech recognition benchmark", "Announce Type: new Abstract: WER evaluation"), papers), true);
  const strict = { ...papers, config: { ingestNoiseFilter: { requireAllGroups: [["agent"], ["eval"]], keepIfMatches: ["agent"] } } };
  assert.equal(noiseFiltered(c("AGENT launch"), strict), true, "a keep word cannot bypass a mandatory evidence group");
  assert.equal(noiseFiltered(c("agent release", "EVALUATION of task completion"), strict), false);
  for (const s of FRONTIER_SOURCES) assert.deepEqual(unsupportedConfig(s.kind, s.config), []);
  assert.equal(new Set(RECENT_SOURCES).size, RECENT_SOURCES.length);
  assert.ok(!RECENT_SOURCES.includes("rss-arxiv-agent-eval"), "do not retry the rate-limited search API");
});

test("official RSS summaries become usable abstracts without replacing announcement time", async () => {
  const rows = (await fetchRss({ ...papers, config: { ...papers.config, feedUrl: endpoint } })).candidates;
  assert.equal(rows.length, 1); assert.equal(rows[0]!.bodyStatus, "ok");
  assert.ok(rows[0]!.bodyText!.includes("Abstract:"));
  assert.equal(rows[0]!.publishedAt!.toISOString(), "2026-10-22T04:00:00.000Z");
  assert.equal(noiseFiltered(rows[0]!, papers), false);
});

test("engineering cards use the dated title link and independent practice filters avoid general news", () => {
  const engineering = FRONTIER_SOURCES.find(s => s.id === "web-anthropic-engineering")!;
  const html = `<nav><a href="/engineering">Engineering</a></nav><article data-listing-row="one"><a href="/research/team/engineering">Team</a><time>Oct 20, 2026</time>
    <a href="/research/wrong-image">Thumbnail</a><h3><a href="/research/agent-evaluation-harness">Agent evaluation harness</a></h3></article>`;
  const rows = fromHtml(html, engineering.config.url, engineering);
  assert.equal(rows.length, 1); assert.equal(rows[0]!.url, "https://www.anthropic.com/research/agent-evaluation-harness");
  assert.equal(rows[0]!.publishedAt!.toISOString(), "2026-10-20T00:00:00.000Z");
  assert.equal(noiseFiltered(rows[0]!, engineering), false);
  const metr = FRONTIER_SOURCES.find(s => s.id === "rss-metr-research")!;
  assert.equal(noiseFiltered(c("Measuring the length of tasks that agents can complete"), metr), false);
  assert.equal(allowed("https://metr.org/notes/time-horizon/", metr), true);
  assert.equal(allowed("https://metr.org/careers/", metr), false);
  for (const id of ["rss-simon-willison", "rss-hamel-evals"]) {
    const source = FRONTIER_SOURCES.find(s => s.id === id)!;
    assert.equal(noiseFiltered(c("How to evaluate a coding agent", "Check the task trajectory"), source), false);
    assert.equal(noiseFiltered(c("GPU financing news"), source), true);
    assert.equal(noiseFiltered(c("A better speech recognition benchmark"), source), true);
  }
  const legacy = { config: { ingestNoiseFilter: { dropMarkers: ["hardware"], keepIfMatches: ["agent"] } } } as SourceRow;
  assert.equal(noiseFiltered(c("Agent hardware"), legacy), false, "old exemption behavior remains compatible");
});
