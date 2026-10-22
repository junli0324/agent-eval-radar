// v0.1 聚焦评测情报；通用模型共识榜不等同于 Agent Evaluation。
// 保留模块代码，通过已有开关关闭入口、接口及定时任务。
export const FEATURES = {
  leaderboard: false,
  codexResetMonitor: false,
} as const;
