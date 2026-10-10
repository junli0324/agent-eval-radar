# 首批信源与验收

使用者已于 2026-09-30 确认「一手源＋独立实践」。12 个源使用免费 RSS/Atom 或官方网页入口；不需要 X/公众号采集密钥。全部只展示摘要与原文链接，`site_fulltext` / `syndicate_fulltext` 为 false。首次回灌每源最多 5 条，旧文遵循原有归档规则。

| 源 | 分级 | 入口与取舍 |
|---|---|---|
| SWE-bench · Releases | T1 | [https://github.com/SWE-bench/SWE-bench/releases.atom](https://github.com/SWE-bench/SWE-bench/releases.atom) |
| OSWorld · Releases | T1 | [https://github.com/xlang-ai/OSWorld/releases.atom](https://github.com/xlang-ai/OSWorld/releases.atom) |
| τ-bench / τ²-bench · Releases | T1 | [https://github.com/sierra-research/tau2-bench/releases.atom](https://github.com/sierra-research/tau2-bench/releases.atom) |
| Inspect AI · Changelog | T1 | [官方 Changelog](https://inspect.aisi.org.uk/CHANGELOG.html)，按版本章节提取，原文链接固定到对应 Git tag 的 CHANGELOG.md |
| Inspect Evals · Releases | T1 | [https://github.com/UKGovernmentBEIS/inspect_evals/releases.atom](https://github.com/UKGovernmentBEIS/inspect_evals/releases.atom) |
| DeepEval · Releases | T1 | [https://github.com/confident-ai/deepeval/releases.atom](https://github.com/confident-ai/deepeval/releases.atom) |
| Promptfoo · Releases | T1 | [https://github.com/promptfoo/promptfoo/releases.atom](https://github.com/promptfoo/promptfoo/releases.atom) |
| Langfuse · Releases | T1 | [https://github.com/langfuse/langfuse/releases.atom](https://github.com/langfuse/langfuse/releases.atom) |
| Terminal-Bench · 任务与协议更新 | T1 | [https://github.com/harbor-framework/terminal-bench/commits/main.atom](https://github.com/harbor-framework/terminal-bench/commits/main.atom) |
| arXiv · Agent Evaluation（摘要） | T1_5 | [https://export.arxiv.org/api/query](https://export.arxiv.org/api/query?search_query=(cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG)+AND+(ti:agent+OR+abs:agent)+AND+(ti:evaluation+OR+ti:benchmark+OR+abs:evaluation+OR+abs:benchmark)&sortBy=submittedDate&sortOrder=descending&max_results=30) |
| Hugging Face · Blog | T1_5 | [https://huggingface.co/blog/feed.xml](https://huggingface.co/blog/feed.xml) |
| Simon Willison | T2 | [https://simonwillison.net/atom/everything/](https://simonwillison.net/atom/everything/) |

GitHub 官方项目 Releases 用 T1 / first_party；GitHub 只是托管平台，不自动归为发布者。Langfuse/Promptfoo 等通用工具的普通产品更新仍须通过严格评测相关性筛选。

arXiv 以 Agent × evaluation/benchmark 查询 cs.AI/cs.CL/cs.LG，而非全量灌入 cs.AI。每次最多返回最近 30 条；高峰期可能漏召回，后续用真实流量检查覆盖率。摘要只代表作者提供的预印本摘要，不代表读过全文、同行评审或独立验证。arXiv 与 Hugging Face 聚合内容采用 T1_5 / first_party=false，不将托管平台冒充论文作者；Hugging Face 源较宽，相关性筛选应排除非评测内容。Simon Willison 采用 T2。

Terminal-Bench 原 laude-institute 仓库已重定向到旧版本仓库，旧 Releases 为空。当前项目是 harbor-framework/terminal-bench，采用其 main commits Atom（明确命名为任务与协议更新）。普通维护提交不值得精选；后续可补充官方版本公告入口，不能把 commit 当新 Benchmark 发布。

2026-09-30 已做公开 HTTP 检查：所有最终配置入口返回 200 且包含条目。还须通过项目生产 RSS parser 检查标题、链接与日期；真实采集/正文抽取/LLM 质量不由连通性检查证明。

sources.json 只在首次 seed 时插入新源，不覆盖后台已有记录。若某个部署已导入原模板 18 个源，需在后台逐项停用这些旧源再启用本站信源；仅改 JSON 不会自动删除数据库中的旧信源。不要清空生产库。

## Inspect AI 本地试用修复（2026-10-09）

真实试用发现 Releases Atom 只有版本号；0.3.277 的网页是 Git tag 页面，没有 Release 正文，Release API 返回 404。连通性通过并不代表材料质量合格。现在保留原 source ID `rss-inspect-ai` 以维护历史关联，将类型改为 `web_list`，用 `inspect_changelog` 适配器解析官方 Quarto 页面。

每个版本只取自己的章节，保留完整更新内容供模型阅读；日期只精确到日，按 UTC 零点存储，不代表确切发布时间。每轮窗口最多 10 个版本，首次导入最多 5 个。链接和去重身份固定到版本对应的 GitHub CHANGELOG.md，因为官网按日期生成的章节锚点会随新版本插入而变化。

已有站点必须显式运行 [本地更新步骤](local-trial-update.md) 中的升级脚本，单纯 git pull 或重新 seed 不会覆盖已有信源。升级保留启停、分级、全文权限和历史数据；只接受旧默认配置或新默认配置，遇到自定义配置直接停止，不覆盖人工设置。
