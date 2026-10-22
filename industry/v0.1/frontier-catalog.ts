import type { SourceRow } from "@aihot/backend/sources/types";

export const FRONTIER_IMPORT = "agent-eval-frontier-v1";
export const SIMON_SEED_CONFIG = { feedUrl: "https://simonwillison.net/atom/everything/", summaryIsBody: false, _aihot: { initialBackfillLimit: 5 } };
const evaluation = ["eval", "benchmark", "grader", "judge", "task success", "task completion"];
const agent = ["agent", "computer use", "tool use", "tool-use", "swe-bench", "osworld", "tau-bench", "τ-bench"];
const common = { enabled: true, cursor: null, fail_count: 0, participation_mode: "editorial" as const };

// Discovery only: all groups must match before a paid relevance decision. Never preselect an item.
export const FRONTIER_SOURCES: SourceRow[] = [
  {
    ...common, id: "rss-arxiv-agent-papers", name: "arXiv · Agent 评测新论文公告（摘要）", kind: "rss", tier: "T1_5", first_party: false, interval_minutes: 240,
    config: { feedUrl: "https://rss.arxiv.org/rss/cs.AI+cs.CL", summaryIsBody: true, sortByPublishedAt: true,
      allowUrlPrefixes: ["https://arxiv.org/abs/"], _aihot: { initialBackfillLimit: 5 },
      ingestNoiseFilter: { requireAllGroups: [["announce type: new "], ["agent"], evaluation] } },
  },
  {
    ...common, id: "rss-metr-research", name: "METR · 评测研究与实践", kind: "rss", tier: "T1_5", first_party: true, interval_minutes: 240,
    config: { feedUrl: "https://metr.org/feed.xml", summaryIsBody: false, sortByPublishedAt: true,
      allowUrlPrefixes: ["https://metr.org/blog/", "https://metr.org/notes/"], _aihot: { initialBackfillLimit: 5 },
      ingestNoiseFilter: { requireAllGroups: [[...agent, "autonom", "horizon", "eval", "benchmark", "monitor", "reward hacking", "sandbagg"]] } },
  },
  {
    ...common, id: "web-anthropic-engineering", name: "Anthropic · Engineering", kind: "web_list", tier: "T1_5", first_party: true, interval_minutes: 180,
    config: { url: "https://www.anthropic.com/engineering",
      itemSelector: 'article[data-listing-row], a[class*="PublicationList"][href]',
      linkSelector: 'h3 a[href], a[class*="PublicationList"][href]', titleSelector: 'h3, span[class*="__title"]',
      publishedAtSelector: "time", publishedAtUtcOffset: "+00:00", sortByPublishedAt: true, fetchPublicContent: true,
      allowUrlPrefixes: ["https://www.anthropic.com/research/", "https://www.anthropic.com/engineering/"],
      _aihot: { initialBackfillLimit: 5 }, ingestNoiseFilter: { requireAllGroups: [[...evaluation, "harness", "reliab", "failure", "quality report", "effective tools", "multi-agent research"]] } },
  },
  {
    ...common, id: "rss-simon-willison", name: "Simon Willison · Agent 评测实践", kind: "rss", tier: "T2", first_party: false, interval_minutes: 180,
    config: { ...SIMON_SEED_CONFIG, feedUrl: "https://simonwillison.net/tags/evals.atom", sortByPublishedAt: true, allowUrlPrefixes: ["https://simonwillison.net/"],
      ingestNoiseFilter: { requireAllGroups: [agent, [...evaluation, "harness", "prompt injection", "failure", "reliab"]] } },
  },
  {
    ...common, id: "rss-hamel-evals", name: "Hamel Husain · 评测工程实践", kind: "rss", tier: "T2", first_party: false, interval_minutes: 240,
    config: { feedUrl: "https://hamel.dev/index.xml", summaryIsBody: false, sortByPublishedAt: true,
      allowUrlPrefixes: ["https://hamel.dev/blog/", "https://hamel.dev/notes/"], _aihot: { initialBackfillLimit: 5 },
      ingestNoiseFilter: { requireAllGroups: [[...evaluation, "error analysis", "trace"], [...agent, "trajectory", "multi-step", "multi-turn", "tool call"]] } },
  },
];
