# 近期内容与日报：Windows 限量试运行

历史资料库已有 34 篇公开内容。本流程补上近期资讯入口，复用现有采集、模型回执、预算、发布层与日报生成器，不改数据库或精选阈值。热门需要真实传播与事件证据，本轮不运行归组、嵌入或热度任务，也不启动 worker。

## 1. 更新并查看状态（不花模型费用）

Docker Desktop 和 Bitz Net 保持运行。在 PowerShell 执行：

```powershell
cd D:\Projects\agent-eval-radar
docker compose stop worker
git -c http.proxy=http://127.0.0.1:7897 -c http.version=HTTP/1.1 pull --ff-only origin feat/agent-eval-v0.1
docker compose cp industry/v0.1/recent-policy.ts api:/app/industry/v0.1/recent-policy.ts
docker compose cp industry/v0.1/recent-trial.ts api:/app/industry/v0.1/recent-trial.ts
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/recent-trial.ts status
```

独立脚本复制后即可运行；本流程不修改 `.env`，不需要重建镜像。容器重建后需重新复制，或正常构建包含新文件的镜像。不要执行删除卷的命令。

状态读取四个窄信源：Inspect AI、τ-bench、DeepEval、Langfuse，以及安装后可用的两个官方博客（见 [近期研究与博客更新](frontier-update-20261019.md)）。输出信源健康、上次成功、下次可采集时间、历史归档数量，以及最近 14 天**有原始发布日期、非补录**的候选（最多展示 20 条，含已有分析与发布状态）。没有候选是有效结果，不把旧文章改日期来填充。正文/分析会排队，但 worker 停止时不会自动处理。

## 2. 一次采集两个信源（不调用模型）

```powershell
docker compose exec -T -e COLLECT_ENABLED=true -e MODEL_CALLS_ENABLED=false api node industry/v0.1/recent-trial.ts collect --sources=rss-inspect-ai,rss-tau2-bench
```

每次指定 1–3 个白名单信源。后续可单独试 `--sources=rss-deepeval,rss-langfuse`。保持仓库适配器原有入库上限：首次按信源配置通常 5 条，已初始化 RSS 每源最多 60 条，Inspect 适配器窗口 10 条；这是采集上限，**不是模型分析数量**。暂停信源不强行启用，未到 `nextFetchAt` 会跳过；任何失败停止当前批次，并沿用原退避时间，不连续重试 429。

新信源首次入库带 `first-import` 补录标记；旧条目也可能按发现时效自动归档。这些文章保留，但不进入本流程的近期分析或日报。以后真正新发布的条目才能进入近期链路。原 arXiv 限流搜索 API 与泛内容博客不在白名单；新增官方 RSS 与实践入口见[扩充说明](frontier-sources.md)，首次存量同样按补录处理。

## 3. 选定 ID，提取正文，再分析（每批最多 3 篇）

将下面的 `ARTICLE_ID` 替换为 `status` 输出中的真实 ID。先选一篇；没有合适候选就先停止，不需要调用模型。

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/recent-trial.ts extract --ids=ARTICLE_ID
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/recent-trial.ts status
```

提取只使用原始网页，不使用付费 Jina fallback。`body_status` 必须是 `ok` 才运行下面的命令；`unconfirmed` 先排查来源，不盲目重试模型。

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=true api node industry/v0.1/recent-trial.ts analyze --ids=ARTICLE_ID
```

这是本流程第一个付费步骤：一篇可能包含预筛、结构、两次评分、理解和摘要等多次请求，并非一次模型调用。沿用现有预算和回执；输出 token/cost，`cost: null` 表示费用未知，最终以服务商账单为准。可用逗号指定最多三篇，顺序执行；已有当前版本分析会跳过，不强制重打或自动发布。

人工核对中文标题、摘要事实、分类、能力标签依据、精选理由。评测对象主要是 Agent 的任务执行；不能因“使用 Agent”或出现模型成绩就认定属于本站。框架普通补丁可以相关但不精选；精选不等于热门。错误分类与标签先修正审核，切勿降低阈值凑数量。

## 4. 审核后发布

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/recent-trial.ts publish --ids=ARTICLE_ID
```

同批验证通过才发布；旧版本分析、非相关内容、乱码、人工精选覆盖与分析判定不一致都会停止/回滚。保持原始评分与精选结果，不写新的人工覆盖。重复发布走原有幂等路径。精选通常等几分钟释放后再查看网站；普通相关文章仍可在相应列表阅读。

## 5. 日报先预览，再生成

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/recent-trial.ts daily-preview
```

默认取**最近已结束**的北京时间日报窗口：D 日日报覆盖 `[D-1 日 08:00, D 日 08:00)`。按公开发布层的到达/释放时间计算，排除所有补录和前七期已覆盖的内容，预览不写报告、不调用模型。可加 `--date=2026-10-19` 查询指定已结束的日期，不允许未来窗口。

`fresh > 0` 且未有同日日报时，才执行：

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=true api node industry/v0.1/recent-trial.ts daily
```

这个命令可能调用报告模型并直接保存日报；已存在的日报跳过，空候选也跳过，不写空日报或反复创建修订。预览与生成沿用相同候选/去重规则，实际每节条数仍由原生成器限制。08:00 之后才释放的文章归下一窗口，需等次日 08:00 后生成；不把今天刚发布的资料硬塞进已经结束的日报。

后续先观察几轮近期候选质量、真实账单和日报；确认队列与费用上限后再决定持续 worker 运行。关掉终端不会删除网站内容或数据库，重开后回到项目目录执行 `docker compose ps` 和本流程 `status` 即可。
