import catalog from "./topics.json" with { type: "json" };

// Both the topic seed and the directory headings use the same industry configuration.
export const TOPIC_GROUPS = catalog.groups;
export const TOPICS_PAGE = {
  title: "按主题看评测",
  description: "按 Agent 场景、情报分类与研究机构浏览 Agent Evaluation 精选资料。",
  intro: "按 Agent 场景、情报分类与研究机构浏览",
  empty: "待补充精选",
} as const;
