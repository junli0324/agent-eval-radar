# 到期后的只读复盘

先确认真实运行状态、质量和账单，再决定下一轮。不要通过 `stop` 后重新 `prepare` 延长已授权窗口；`stop` 会尝试恢复旧预算，并不只是停止容器。只暂停执行用 `docker compose stop worker`，保留当前额度保护。

## Windows 检查

Docker Desktop 就绪后，在已有项目目录逐行执行。下列查询不调用模型，不采集、不发布、不改预算或到期时间。不要输出或分享 `.env`。

```powershell
cd D:\Projects\agent-eval-radar
docker compose ps -a
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/auto-trial.ts status
docker compose logs --tail=10 worker
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/trial-review.ts
```

最后一个工具需要包含新代码的 API 镜像；如提示文件不存在，按[更新栏升级步骤](content-updates.md)更新镜像，保持 worker 停止。不要为查询启动普通 worker，也不要使用 `docker compose down -v`。

`trial.state` 是已保存的配置，`trial.active` 才同时检查时间和状态；到期可能显示 `state: active`、`active: false`。受限 worker 此时应记录 `trial-ended` 并以退出码 0 退出。数据库时间、容器退出与最后请求时间应交叉核对。`requests24h: 0` 不能证明整个试运行免费。

## 怎样读复盘结果

`trial-review.ts` 使用数据库只读、可重复读事务，输出脱敏汇总，不输出模型请求、响应、密钥或正文。无需迁移，不改变发布规则。

| 字段 | 含义与边界 |
| --- | --- |
| `status` | 计算后的 active / expired / stopped / not-started；没有配置则 not-prepared |
| `requests.attempts` / `logical_requests` | 从本次开始到检查时的实际请求尝试数与逻辑回执数；重试分别计数，排除 replay / imported 和未来记录 |
| `started_after_expiry` / `finished_after_expiry` | 截止后开始请求、截止前开始但截止后结束；在途任务允许结束，非零值需结合 worker 日志核对 |
| `recorded_tokens` / `unknown_token_attempts` | 仅累加记录的 total_tokens；缺失的另计，不能当成完整用量 |
| `unknown_cost_attempts` / `costs` | 未知费用单独计数；已知费用按币种和 actual / estimated 分组，不能混加或冒充提供商账单 |
| `steps` | 按用途查看请求量与记录 token，定位分析、评分、归组或报告对额度的占用 |
| `publications` | 白名单中从试运行开始后更新、目前可读的文章；精选、普通与补录分开，不等于新增篇数或准确率 |
| `reports` | 最近 12 份存储报告，含旧空占位与补录刊；readable 复用公开读取层谓词，citations 是引用条目数，不是独立来源数 |

请求时间汇总覆盖该时间段所有 `llm` 入口，不能严格归因于受限 worker。不要将原始发现数、公开投影更新次数、文章数、请求数和 token 混为一谈。

## 下一阶段的小步顺序

1. **零付费验收**：核对 worker 已退出、截止后请求与遗留任务、接口及浏览器更新栏。保留现有预算，不重跑付费处理。
2. **现有内容抽检**：先从已公开精选、普通文章和拦截中各选少量材料，按原文证据检查相关性、精选价值、摘要事实、分类和标签。先用 12–20 条 development 样本定位错误；这不替代[独立 gold set](calibration.md)，不据此宣称准确率达标，也不降低门槛。
3. **报告检查**：区分正常刊、补录刊与不公开的空占位。抽查窗口、原始日期、引用可读性和数值，不把有合格文章却未出刊直接解释为无素材；结合 `lastTick.errors` 与 `steps` 判断预算等待。热点仍需最近 48 小时同事件至少两个独立参与来源。
4. **账单后再决策**：运营者在提供商后台核对本次时间段费用；未核对前不报价、不推算人民币余额，也不续期。若后续批准下一轮，单独确认窗口、请求及金额边界，再依据证据决定是否优化任务顺序或限制单轮文章处理量；不默认扩源或改阈值。

状态快照和人工逐条判断保存在本地 `.data/`，不要提交数据库、原始模型回执、全文或账单。工程检查通过与真实内容质量验收分别记录；正式合并和发布仍需产品验收。
