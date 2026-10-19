# 2026-10-19：补充近期研究与官方博客

四个 Release / Changelog 信源已在 Windows 本地正常采集；近期候选为 0 不代表故障。本轮转向研究材料，增加六个已核对原始出版页的候选，并准备两个官方博客列表来源。

## 六个新增候选

| 原始日期 | 材料 | 评测重点 |
|---|---|---|
| 2026-10-14 | [BizBench](https://arxiv.org/abs/2610.20424) | 长期业务任务的目标完成和执行约束 |
| 2026-10-15 | [Kolab](https://arxiv.org/abs/2610.21109) | 人机协作、贡献采纳与工作流质量 |
| 2026-10-12 | [When Agent Evaluation Becomes Unreliable](https://arxiv.org/abs/2610.16067) | 评分器完整性与配置依赖的测量偏差 |
| 2026-10-05 | [A Trust Layer for Agent Evaluation](https://arxiv.org/abs/2610.07274) | 成绩证据、完成声明和重复运行稳定性 |
| 2026-10-15 | [OmicsBench](https://arxiv.org/abs/2610.21074) | 多轮依赖任务、确定性评分与失败模式 |
| 2026-10-09 | [Anthropic 评测异常行为调查](https://www.anthropic.com/research/investigating-unintended-model-actions) | 评测中的越权行为、轨迹审计和隔离实践 |

论文仅导入原始摘要，文章读取官方正文后只公开中文摘要和原文链接。上述日期是首次发布日，不是本次抓取日；预印本与厂商报告中的结论均为作者报告，不等于独立复现。候选不预设精选判定，也不保证分类一定按预期产生。

六篇追加到 `coverage-catalog.json`，复用原资料库命令；原 14 篇覆盖材料和基础资料保留。所有本次补录仍按原始日期归档，**可审核后在网站阅读，但不进入当天新闻和日报**。既有 48 小时发现归档规则、评分阈值、热门与精选逻辑均不改动。

## Windows 更新与导入

Docker Desktop、Bitz Net 保持运行。先导入阅读材料，再采集新增博客，避免同一文章先从另一路径进入后无法在试用资料库中查看。

```powershell
cd D:\Projects\agent-eval-radar
docker compose stop worker
git -c http.proxy=http://127.0.0.1:7897 -c http.version=HTTP/1.1 pull --ff-only origin feat/agent-eval-v0.1
docker compose cp industry/v0.1/. api:/app/industry/v0.1/
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/blog-sources.ts
docker compose exec -T -e COLLECT_ENABLED=true -e MODEL_CALLS_ENABLED=false api node industry/v0.1/trial-library.ts import --set=coverage --limit=6
```

复制的是仓库内的 UTF-8 文件，不包含 `.env` 或密钥，不通过 PowerShell 管道传中文。安装脚本只创建缺少的来源；重复执行不改配置、游标、已有分级或人工启停状态。发现来源配置冲突时整个安装回滚，交由后台核对。没有请求外网或模型；最后的导入命令才请求原始出版页，无模型调用。arXiv 页面访问间隔至少 3.5 秒，遇到 429 停止，不立即重试。

导入后先查看：

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/trial-library.ts status --set=coverage
```

然后最多分析三篇（付费步骤），审核输出后再按 ID 发布：

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=true api node industry/v0.1/trial-library.ts analyze --set=coverage --limit=3
```

这个命令跳过已有当前版本分析，不自动发布。检查事实、摘要、分类、能力标签和精选理由；如需修正文案，使用后台或 UTF-8 文件审核流程。不要用中文 PowerShell here-string 管道修改数据库。费用看回执与服务商账单。

## 两个持续发现入口

- `web-langchain-blog`：读取官方博客 `.blog-item` 的标题、日期、链接，仅保留 eval/benchmark/grader/red team 标题候选。
- `web-anthropic-research`：读取官方研究列表中带日期的文章卡片，保留 eval/benchmark/agent/alignment assessment 标题候选。

两者均用已有 `web_list`，不需要新适配器、API Key、浏览器渲染或 Jina。标题词只是入库范围，之后仍由本站预筛和评分判断是否涉及 Agent 评测。分级沿用资料库官方材料的 T1_5，站内与外部分发全文权限关闭；每三小时一次，首次最多五条。全局十二源种子不变，它们是本地可选来源。

完成上面的资料导入后，可以初始化两个博客：

```powershell
docker compose exec -T -e COLLECT_ENABLED=true -e MODEL_CALLS_ENABLED=false api node industry/v0.1/recent-trial.ts collect --sources=web-langchain-blog,web-anthropic-research
```

初始化条目也是补录，出现近期候选 0 属于预期。此后按间隔检查，真正新发现且符合时效的材料才进入 `recent-trial.ts status` 的近期列表；不要重复初始化、改游标或移除归档标记来填日报。需要定时运行时再接持续任务，本轮 worker 保持停止。
