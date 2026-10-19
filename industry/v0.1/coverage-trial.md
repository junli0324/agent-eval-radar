# 本地内容扩充：补齐分类覆盖

## Windows 中文人工修正的编码修复

Windows PowerShell 的文本管道可能把中文编码为 `?`。不要再通过 `@' ... '@ | docker ... node` 传递含中文的修正脚本。模型回执与原始分析通常不受影响；受损的是这次人工覆盖字段。仅修改终端显示编码不能恢复已经存进数据库的问号。

本仓库的 `repair-review-encoding.ts` 从 UTF-8 文件读取已审核的 12 条修正规格（本轮 10 条，加 GAIA 与 AgentDojo），仅恢复可识别的损坏字段；保留干净的人工修改、评分、精选、原始材料、分析和回执。整批在同一事务内重建 publication 并校验文字，失败会回滚；重复运行不会重复修改。其他编辑者的受损记录停止等待人工处理，不盲目覆盖。审核日志保留修复前后的值。

更新代码后，不必重建镜像即可将 UTF-8 文件复制进现有 API 容器：

```powershell
docker compose cp industry/v0.1/repair-review-encoding.ts api:/app/industry/v0.1/repair-review-encoding.ts
docker compose cp industry/v0.1/local-review-20261019.json api:/app/industry/v0.1/local-review-20261019.json
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/repair-review-encoding.ts
```

`modelCalls: 0`、各条 `publicTextOk: true` 为正常结果。刷新页面确认；后续常规构建镜像也会包含这两个文件。日常修正优先使用后台编辑器，或运行已保存为 UTF-8 的仓库脚本。不要重跑旧中文管道命令。

已导入的 20 篇大多是 Benchmark，不能代表整个 Agent Evaluation 内容面。这轮新增独立的 `coverage` 候选集，共 14 条，优先覆盖评测方法、论文研究、工具框架、评测结果、实践观点。`expectedCategory` 只是人工选题意图，不会覆盖模型分类、评分或精选判定；以实际材料的核心贡献验收。

## 内容目录

| 候选 | 目标方向 | 一手材料 |
| --- | --- | --- |
| AI Agents That Matter | 研究：成本、准确率与过拟合 | [arXiv](https://arxiv.org/abs/2407.01502) |
| Demystifying evals for AI agents | 实践：grader 与回归评测 | [Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) |
| Harbor · Core concepts | 工具：沙箱任务、验证器、轨迹 | [Harbor 文档](https://docs.harborframework.com/core-concepts) |
| Claude 3.5 Sonnet SWE-bench Verified | 结果：历史 scaffold 实验 | [Anthropic](https://www.anthropic.com/engineering/swe-bench-sonnet) |
| Survey on Evaluation of LLM-based Agents | 研究：评测体系综述 | [arXiv](https://arxiv.org/abs/2503.16416) |
| Agent-as-a-Judge | 方法：对 Agent 过程提供评判与反馈 | [arXiv](https://arxiv.org/abs/2410.10934) |
| Writing effective tools for agents | 实践：用任务评测迭代工具 | [Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents) |
| Inspect Cyber | 工具：安全 Agent 评测扩展 | [官方文档](https://inspect.cyber.aisi.org.uk/) |
| Eval awareness in BrowseComp | 结果：评测识别与答案泄漏 | [Anthropic](https://www.anthropic.com/engineering/eval-awareness-browsecomp) |
| Gaming the Judge | 研究：轨迹改写与裁判误判 | [arXiv](https://arxiv.org/abs/2601.14691) |
| Agent trajectory evaluations | 方法：轨迹匹配与模型裁判 | [LangChain 文档](https://docs.langchain.com/langsmith/trajectory-evals) |
| Common questions about agent evals | 实践：评测落地常见问题 | [LangChain](https://www.langchain.com/blog/common-questions-about-agent-evals) |
| Evaluation and Benchmarking of LLM Agents | 研究：评测目标与过程综述 | [arXiv](https://arxiv.org/abs/2507.21504) |
| GroundEval | 方法：检查有状态 Agent 的证据路径 | [arXiv](https://arxiv.org/abs/2606.22737) |

此目录按截至 2026-10-19 可访问的一手页面整理，不是每日最新消息集，也不是 gold set。论文仍只读摘要；官方文章读可提取正文，公开站点仍仅展示中文摘要与原文链接。官方文档明确标注为抓取日期的快照，不猜测发布日期。研究中的成绩和厂商实验不是独立复现，也不是当前榜单。

## 更新并导入首批 10 条

打开 Docker Desktop 与本地代理，在 PowerShell 逐行执行；任一步失败则停止。保持原有数据库卷与 `.env`。

```powershell
cd D:\Projects\agent-eval-radar
docker compose stop worker
git -c http.proxy=http://127.0.0.1:7897 -c http.version=HTTP/1.1 pull --ff-only origin feat/agent-eval-v0.1
docker compose build
docker compose up -d --no-deps --force-recreate api web
docker compose exec -T -e COLLECT_ENABLED=true -e MODEL_CALLS_ENABLED=false api node industry/v0.1/trial-library.ts import --set=coverage --limit=10
```

导入不调用模型或付费网页提取服务。最多读取 10 条新材料，每条间隔至少 3.5 秒，已存在的材料跳过，失败时保留之前成功项。429 时停止，不立即反复重试。

第一次导入官方网页时会按发布方建立最多 4 个 `trial-*` 本地试用信源，沿用 T1_5 门槛；均为 `external`、关闭定时采集与全文展示。不会把官方文章假挂到 arXiv 信源，不会覆写现有信源设置。基础 `sources.json` 仍为 12 个来源，公开仓库不保存用户数据库。

## 分析与审核

本轮最后四条，以及此前暂缓的 DeepSWE 文案修正，已固化为 `coverage-final-review.json` 与 `publish-coverage-final.ts`，避免再次通过 PowerShell 管道传递中文代码。脚本核对当前材料版本与原分析文本/标签指纹，只修改已审核文案与分类标签；不改分数或精选状态。整批事务内发布，失败回滚，可重复运行：

```powershell
docker compose cp industry/v0.1/publish-coverage-final.ts api:/app/industry/v0.1/publish-coverage-final.ts
docker compose cp industry/v0.1/coverage-final-review.json api:/app/industry/v0.1/coverage-final-review.json
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/publish-coverage-final.ts
```

四条补充集资料为 LangChain 轨迹评测、Agent 评测常见问题、评测综述和 GroundEval。另外将 DeepSWE 的绝对化防泄漏表述改为降低风险，明确裁判分歧率不等于真实错误率，依据原论文摘要 https://arxiv.org/abs/2607.07946 。原分析若已重新运行并发生变化，脚本停止，需重新人工审核；不强制覆盖已有不同人工编辑。

网页正文比论文摘要长，token 消耗可能增加。先分析最多 5 篇（会产生模型费用），查看摘要与提供商账单后继续：

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=true api node industry/v0.1/trial-library.ts analyze --set=coverage --limit=5
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/trial-library.ts status --set=coverage
```

重复分析命令会继续下一批，跳过当前材料版本已有分析的文章。范围只限新 `coverage` 集，不会顺带重评旧库。文章数不是金额上限，费用仍走原有回执与预算，`cost: null` 不是免费。

审核时确认：

- 工具文档应写成工具能力介绍或方法说明，不能把抓取日期说成首次发布日期。
- Sonnet/BrowseComp 等结果必须保留模型、基准与实验时间限定，不能宣传为当前最强。
- Agent-as-a-Judge 的评测对象必须是 Agent 的任务表现；不能仅因用了 Agent 当裁判就收录无关的基础模型评测。
- 不把规划、检索自动标成记忆；轨迹必须有实际证据；多模型对比不等于 Multi-Agent。
- 达不到精选但有相关价值的内容可以进入全部内容页，不为填栏目改分数或阈值。

确认后沿用原发布命令，替换为本次审核的 ID，每批最多 10 条：

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/trial-library.ts publish --ids=替换为确认过的文章ID
```

首批处理完，再执行同一导入命令读取剩余 4 条；无需重复复制 ID 或清空数据库。基础候选集还剩的 10 篇仍可用不带 `--set=coverage` 的原导入命令读取，但优先完成这轮分类覆盖。

## 查看有效发布状态

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/trial-library.ts overview
```

`overview` 统计试用库的导入、分析、已公开、已释放精选与实际分类数，列出待处理项。`status` 的 `title_zh/tags/selected` 保留原分析，`public_title/public_tags/public_selected/public_category` 才是 publication 应用人工修正后的结果。不会把 GAIA 的旧空标题误报成修正丢失。

## 为什么有些页面仍可能空

- 分类与 Topic 页：依赖已公开内容的分类和标签；新集只提供候选，不保证自动均匀分布。
- 热点页：需要当前事件、归组与来源传播证据。历史回填不创建事件、不加热度；不能拿专业评分伪造热门。
- 日报、周报、月报：现有报告读取明确排除 `backfill`。即使手动运行报告任务，历史资料也不会自动变成今天的情报。应在试用资料库充实后，另做有限量近期采集和报告链路验收。
- 收藏和阅读历史：需要用户实际收藏或阅读；保持个人操作产生内容。

先在 `/all` 与分类、Topic 页验收内容可用性。日报与热门保留真实语义，不为了填空把历史论文改成今日新闻。
