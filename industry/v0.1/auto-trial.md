# 本地三天受限自动运行

此入口复用现有采集、正文提取、分析、发布、归组、事件综述和报告函数，只修改行业包。它不会注册普通 worker 的队列处理器，也不消费已有队列。历史文章、补录标记、日期和已有人工修改均保留。

## 范围与费用保护

- 白名单为 Inspect AI、τ-bench、DeepEval、Langfuse、LangChain 博客、Anthropic Research。只采集其中已启用、editorial、摘要展示的 RSS / web_list，遵守原有到期时间、退避及导入上限。
- 每轮最多检查 30 条最近 14 天、有原始日期、非补录的资料；正文成功后才分析。单篇顺序处理，质量检查通过后自动发布，拦截结果不会成为公开阅读材料。人工覆盖仍由原发布层保留。
- 只使用当前默认的 `deepseek-flash` 非思考模式。用准备脚本核对各实际调用能力的模型路由；如存在其他模型覆盖，停止配置并提示核对。所有付费步骤继续经过现有回执和预算。
- `llm` 服务最多 5 次/分钟、30 次/小时、100 次/滚动 24 小时；原上限更低时保留更低值。重试计入次数，已有调用记录不清零。分析、归组、综述、报告共用额度。这是请求上限，不是人民币金额上限。
- 关闭付费 Jina 正文兜底、embedding、全文翻译、飞书推送和 IndexNow。本入口不调用 X / 公众号付费采集。无 embedding 时沿用现有归组回退策略，跨来源关系召回可能有限。
- 持续运行 72 小时，不通过重复启动延长。到期不再启动新任务，已经在途的一项操作允许结束，然后进程退出。100 次保护继续保留，直到显式停止恢复。

归组与报告仍遵循原行业规则。热点按原来的 48 小时独立参与者证据计算；没有足够证据时仍可为空。每五分钟检查已结束的报告窗口并补缺：日报北京时间 08:00 后、周报周一 10:00 后、月报每月 1 日 10:30 后。没有合格材料时不出刊，历史补录不填实时报告。W42 的补录资料周报会保留，不被覆盖。

## Windows 启动

Docker Desktop、网络与代理保持运行；准备阶段无模型调用。以下命令不读出或改写 `.env`：

```powershell
cd D:\Projects\agent-eval-radar
docker compose stop worker
git -c http.proxy=http://127.0.0.1:7897 -c http.version=HTTP/1.1 pull --ff-only origin feat/agent-eval-v0.1
docker compose build api
docker compose up -d --no-deps api web
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/auto-trial.ts prepare
docker compose -f docker-compose.yml -f industry/v0.1/compose.auto-trial.yml up -d --no-deps worker
```

最后一条才开启自动采集与模型调用。`prepare` 显示开始、到期、有效额度与信源；再次准备不会延期。设置存入既有 settings 表，旧预算留有快照与审计记录，无数据库迁移。受限入口启动配置只作用于 worker，API/Web 的安全阀不改。

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/auto-trial.ts status
docker compose logs --tail=30 worker
```

状态输出试运行截止时间、滚动 24 小时实际请求次数、试运行回执 token、未知费用回执数和最后一轮结果。`modelCalls: 0` 仅表示这条状态查询本身不调用模型，不表示后台没有费用。账单以 DeepSeek 为准。关闭 PowerShell 不影响后台容器；睡眠、关机或代理断开会影响连续运行。非正常退出最多重启三次；到期正常退出不重启。

## 停止与恢复预算

```powershell
docker compose stop worker
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/auto-trial.ts stop
```

先等待在途任务结束，再恢复旧预算。恢复时若发现预算被人工改过，会保留人工修改并返回 `budgetRestored: false`。停止不删除任何资料、报告或队列。以后启动仍使用本节的双 Compose 文件命令；普通 `docker compose up worker` 会恢复上游普通 worker，试运行期间应使用受限入口。
