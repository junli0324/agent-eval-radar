# 扩充自动运行的论文与实践入口

原六源以版本发布为主，采集正常也可能长期没有合格新稿。本轮将可用白名单扩为 11 个入口：新增四个独立 source ID，并将已有 Simon Willison 源升级为更聚焦的评测专题订阅。实际运行仍只使用已安装、启用且保持摘要权限的来源。

## 入口与取舍

| 入口 | 类型与分级 | 免费发现筛选 |
| --- | --- | --- |
| [arXiv cs.AI + cs.CL](https://rss.arxiv.org/rss/cs.AI+cs.CL) | RSS 摘要，T1_5 | 只接收 `Announce Type: new`，且标题／摘要同时包含 Agent 和评测相关词；不把旧论文替换或交叉公告当成新论文 |
| [METR](https://metr.org/feed.xml) | 官方评测研究，T1_5 | 限 blog / notes 路径；评测、自主任务、time horizon、监测或评测完整性相关材料 |
| [Anthropic Engineering](https://www.anthropic.com/engineering) | 官方工程实践，T1_5 | 有日期的文章卡片；评测、Harness、可靠性与工具实践；兼容迁往 `/research/` 的文章链接 |
| [Simon Willison · Evals](https://simonwillison.net/tags/evals.atom) | 独立技术分析，T2 | Agent 场景加评测、Harness、失败或可靠性证据，避免其他主题挤出订阅窗口 |
| [Hamel Husain](https://hamel.dev/index.xml) | 独立评测工程实践，T2 | 评测／错误分析／轨迹与 Agent／多步骤／工具调用同时出现 |

arXiv 官方支持多分类订阅：[RSS 使用说明](https://info.arxiv.org/help/rss.html)。它每天提供公告，不能作为完整历史检索入口；这里不重试原先返回 429 的 search API。公告时间是官方 RSS 的公告时间，不冒充论文首次提交时间。只读取摘要，成绩为作者报告，不代表读过全文、同行评审或独立复现。

发现筛选只决定是否入库，最终仍走模型相关性预筛和原评分门槛；一般模型评测、泛 Agent 产品新闻和低价值维护项仍可能被拦截。不会预设入选率，也不承诺每天固定篇数。免费粗筛可能漏掉未使用这些词语的文章，后续通过漏选样本校准。

## Windows 已有试运行升级

以下适用于网站已经跑通、有 `.env`，且正在使用受限 worker 的部署。打开 Docker Desktop 和原有网络代理，逐行执行；任一步失败先停止，保留输出。代理端口按自己的实际配置调整。

```powershell
cd D:\Projects\agent-eval-radar
docker compose stop worker
git -c http.proxy=http://127.0.0.1:7897 -c http.version=HTTP/1.1 pull --ff-only origin feat/agent-eval-v0.1
docker compose build api
docker compose up -d --no-deps api web
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/frontier-sources.ts
docker compose -f docker-compose.yml -f industry/v0.1/compose.auto-trial.yml up -d --no-deps worker
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/auto-trial.ts status
```

无需再次 `prepare`。安装不请求外网、不调用模型；原 72 小时到期时间、5/30/100 请求上限与旧预算快照保持原样。恢复 worker 后处理会使用共享模型额度，仍以提供商账单为准。

首次安装通常显示四条 `created: true`，Simon 显示 `configUpdated: true`；如果 Simon 原来不存在，则为五条新建。重复执行没有重复升级。已有人工暂停、分级、名称、cursor、失败退避和调度时间保留；检测到自定义配置会整批回滚，不覆盖后台设置。新源默认摘要展示，全文与再分发保持关闭。

新源第一次读取的存量条目仍带补录标记，默认每源最多五条，不自动进入本轮实时分析和日报。后续采集按原 48 小时发现规则处理；不要通过修改日期或补录标记填满页面。RSS 论文源与 METR / Hamel 每四小时检查，工程博客与 Simon 每三小时检查。不同来源转发同一文章沿用原去重规则。

## 直接看原因

原 `auto-trial.ts status` 命令现在还会输出：

- `sourceHealth`：每源最近采集时间、下次时间、原始发现数与新增数、补录数量，以及是否满足试运行条件。
- `not_modified: true`：RSS 返回 HTTP 304，`found_count: 0` 表示内容未变化，不能当作源失效。
- `missingSources`：代码列入白名单但数据库尚未安装的入口。
- `pipeline`：近期候选、预筛拦截、待分析、待正文、等待重试、已放行精选与普通公开文章。重试计数与其他阶段可能重叠；只统计当前符合条件的来源，排除补录、未来或无日期资料。

worker 每轮日志增加 `found / created / revised`，分别为采集器发现、新建和修订条目数；发现数在免费筛选之前，新建数可以包含补录。`collected` 仍是执行成功的信源数，`published` 仍是发布投影变化数，不等于新增精选文章。

查询状态可与 worker 同时运行，不调用模型；只有安装和手动处理时需要先停 worker。

## 验证记录

2026-10-22，五个最终入口均通过公开 HTTP 获取；将收到的原始 XML / HTML 在本地回放给生产解析器和发现筛选，核对日期、链接、正文范围与候选。该检查不调用模型、不连接用户数据库，也不等于用户电脑上的采集已经成功。

代码改动以行业目录为主。框架仅增加一个可选的 `ingestNoiseFilter.requireAllGroups`：组内词语 OR、组间 AND，在 keep 豁免之前检查。旧配置行为不变，不引入正则或数据库字段；用于避免泛 AI 论文消耗模型额度。回归覆盖过滤顺序、官方公告、卡片链接、原 seed 升级、事务回滚、worker 锁、预算与到期时间保留，以及只读诊断的统计范围。
