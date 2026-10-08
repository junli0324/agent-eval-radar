// 站点身份和读者看得到的文案。换成你的行业时，先改这个文件。
// 网页和后端都读它；改完重新构建（docker compose up --build）即可生效。
// 域名不在这里：部署时用环境变量 SITE_URL 设置。

export const SITE = {
  /** 站名：导航、页面标题、分享图、RSS、MCP、后台都用它。 */
  name: "AgentEval Radar",
  /**
   * 行业词：拼进默认说法里，比如“AI 日报”“AI 动态”。
   * 改成“法律”“HR”“黄金”之类，页面上就会变成“法律日报”“法律动态”。
   */
  subject: "Agent评测",
  /** 首页的完整标题（浏览器标签、搜索结果）。 */
  homeTitle: "AgentEval Radar — Agent Evaluation 前沿情报",
  /** 一句话介绍：搜索引擎、分享卡片、RSS、llms.txt 会用。 */
  description: "面向中文 AI 产品经理、Agent 评测人员与开发者，追踪 Agent Evaluation 的 Benchmark、评测方法、论文、工具与实践。",
  /** 首页左上角和侧边栏下面的一行小字。 */
  tagline: "看懂 Agent 能力，先看评测证据",
  /** 界面语言（HTML lang、og:locale）。 */
  locale: "zh-CN",
  /** 默认域名，只在没设置 SITE_URL 时使用。 */
  defaultUrl: "http://localhost:3000",
  /**
   * MCP 工具名的前缀（小写字母、数字、下划线），工具会叫 myhot_get_latest、myhot_search……
   * 已经有人接入后就不要再改。
   */
  mcpPrefix: "agent_eval_radar",
  /** 对外联系邮箱（选填）：使用规则、llms.txt、响应头里会写。 */
  contactEmail: null as string | null,
  /** 页脚的一行小字（选填）。 */
  footerNote: "Agent Evaluation · 中文前沿情报",
  /** 中国大陆网站的 ICP 备案号（选填），填了就显示在页脚并链接到工信部备案系统。 */
  icp: null as string | null,
  /** 结构化数据里的网站运营者（搜索引擎用）。 */
  organization: {
    name: "AgentEval Radar",
    /** 创始人（选填）：{ name, url, description }。 */
    founder: null as null | { name: string; url?: string; description?: string },
  },
  /** 抓取信源时报上的名字（User-Agent 里用），不要冒用别的站。 */
  crawlerName: "AgentEvalRadarBot",
} as const;

/** 关于页的文案。数字（信源数、收录数、精选数、日报期数）来自站内实时统计，不用写在这里。 */
export const ABOUT = {
  kicker: `关于 ${SITE.name}`,
  /** 大标题：第一行正常颜色，第二行强调色。 */
  headline: ["Agent 能力如何衡量，", "让评测证据先说话。"] as [string, string],
  /** 标题下面的一段话。{sources} 会换成实时的信源数。 */
  lead: `${SITE.name} 持续追踪 {sources} 个信源中的 Agent Evaluation：用中文整理基准、方法、论文、工具、结果与实践。精选看专业价值，热门看独立来源的传播热度；热门不代表更可靠。`,
  /** 信源河动画下面的四个环节。 */
  steps: {
    collect: "优先跟踪 Benchmark 与评测工具的一手更新、研究论文和独立实践，保留原文链接与来源。",
    store: "同一次发布的不同报道归为一个事件；不同版本、测试集、评测设置与独立复现保留区别。热门按独立来源热度计算。",
    select: "精选依据评测问题、方法增量、证据与可复用性独立评分。提到 Agent、榜单领先或传播广泛，本身都不是入选理由。",
    publish: "按站点时区定期整理日报、周报和月报，说明测了什么、如何测、得到什么结果及适用边界。证据不足时不补写结论。",
  },
  /**
   * 作者块（选填），null 就不显示。
   * avatarSourceId：一个 X 账号信源的 id，头像取它的（选填）。
   * 二维码在后台“设置”里上传，或者放进 industry/brand/contact/；没有二维码就不显示那张卡片。
   */
  maker: null as null | {
    name: string;
    greeting: string[];
    avatarSourceId?: string | null;
    wechat?: { title: string; note: string };
    feishu?: { title: string; note: string };
  },
  /** 页面底部的版权与下架说明（结尾会接“反馈页”的链接）。 */
  copyright: `${SITE.name} 是聚合摘要和阅读索引，原文版权归各来源所有。如果你是来源方，希望更正、下架或调整展示方式，可以通过`,
} as const;

/** “AI 日报”这类说法：行业词和名词之间，英文词加空格，中文词不加。 */
export function withSubject(noun: string): string {
  return /[A-Za-z0-9]$/.test(SITE.subject) ? `${SITE.subject} ${noun}` : `${SITE.subject}${noun}`;
}
