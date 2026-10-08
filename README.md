# AgentEval Radar

面向中文 AI 产品经理、Agent/大模型评测人员与 Agent 开发者的 Agent Evaluation 前沿情报站。

追踪 **评测基准、评测方法、论文研究、工具框架、评测结果、实践观点**。页面与摘要以中文为主，Agent、Benchmark、论文、模型与指标专名保留原文。

**精选衡量专业价值；热门反映独立来源的传播热度。** 提到 Agent、大厂发布、stars 多或宣称 SOTA 都不是自动入选的理由。关注可验证的方法、任务完成、失败模式、污染、可靠性、安全与成本。

## v0.1

- 10 个 Agent 场景 Topic、15 个能力标签、12 个公开 RSS/Atom 信源。
- 领域预筛、独立双评分、中文摘要、结构化抽取、事件归组及日报/周报/月报。
- 自有雷达图标与品牌；关闭通用模型榜和 Codex 重置监控。
- 保留原阈值 T1 60 / T1_5 65 / T2 76，待人工 gold set 校准。
- 不增加数据库字段或 Benchmark Card。公开输出仍共用 publication 读取层。

## 运行

需要 Node.js 24.11+，以及 Docker Compose；非 Docker 方式需要 PostgreSQL 16/17。

```bash
git clone https://github.com/junli0324/agent-eval-radar.git
cd agent-eval-radar
git switch feat/agent-eval-v0.1
npm ci
```

首次用 `node scripts/init-env.ts` 生成本地 `.env`（输出含管理员密码，请勿分享日志）。在本地编辑 `.env` 填入模型服务、`SITE_URL` 等，避免将真实密钥写入命令历史。开发/基础链路验证保持以下开关关闭；此时空站无新内容是预期状态：

```dotenv
COLLECT_ENABLED=false
MODEL_CALLS_ENABLED=false
FEISHU_CONTENT_PUSH_ENABLED=false
FEISHU_INTERNAL_ENABLED=false
INDEXNOW_SUBMIT_ENABLED=false
```

```bash
docker compose up -d --build
node scripts/smoke.ts --base http://localhost:3000
```

网站 `http://localhost:3000`，后台 `/admin`。真实采集、模型预算、运营条款与隐私说明确认后，再显式启用采集和模型调用。绝不提交 `.env`、密钥、密码、数据库和 `.data/`。

## 检查与校准

```bash
npm run typecheck
DATABASE_URL=postgres://127.0.0.1:5432/agent_eval_radar_test node scripts/migrate.ts
DATABASE_URL=postgres://127.0.0.1:5432/agent_eval_radar_test npm test
npm run build -w @aihot/web
node --test apps/web/tests/*.test.ts
node scripts/smoke.ts --base http://localhost:3000
```

[验证记录](industry/v0.1/validation.md) · [信源取舍](industry/v0.1/sources.md) · [gold set 与校准](industry/v0.1/calibration.md) · [部署](docs/deploy.md) · [架构](docs/architecture.md)

`industry/pages/` 的条款与隐私说明仍是待运营者确认的模板。真实模型效果未因工程测试通过而得到验证，示例 gold set 均为虚构格式示例。

## 来源与许可

本项目由 [AIHOT Template](https://github.com/KKKKhazix/AIHOT) 创建，保留其 MIT 许可与原作者版权声明。AgentEval Radar 是独立站点，不代表上游运营者。原框架文档、包名、内部环境变量和技术命名空间保留以避免无意义重构；站点名称、Logo 与报告品牌已独立。见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
