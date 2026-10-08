# AgentEval Radar v0.1 验证记录

## 原版基线

- 上游：`KKKKhazix/AIHOT`，读取版本 `cf8f8d07d68dfa9079becc72b0717a45b33485f3`。
- 使用 GitHub Template 创建独立公开仓库 `junli0324/agent-eval-radar`，不是 Fork。
- 模板初始提交：`0ccda1f369bf25e6709c09e1a693780990befe39`。
- [原版 Check #1](https://github.com/junli0324/agent-eval-radar/actions/runs/36744520760)：2026-09-30，`check` / `docker` 均成功。
- 原版 CI 覆盖 Node 24、PostgreSQL 17、迁移、种子、typecheck、Web 构建、16 项 Web 测试、后端测试、Web/API/RSS/MCP smoke，以及包含 worker 的 Docker Compose 启动。
- 本地 `npm ci`、Web 构建和 16 项 Web 测试成功；本地 TypeScript 7 原生编译器因执行环境缺少 `/proc/self/exe` 退出，类型检查以 GitHub runner 为准。
- 当前执行环境没有 Docker/PostgreSQL，未声称本地完成容器验证；完整链路验证在 GitHub Actions 的临时环境完成。
- CI 使用本地替身，不调用真实模型、不采集外部信源。真实采集与模型效果仍须上线前验收。

## 实施约束

保留 `industry/selection.ts` 的阈值（T1 60、T1_5 65、T2 76）与 understandFloor 50；保留七个内部 itemType、五轴及权重、JSON 输出契约、安全规则和 receipt/budget 机制。无数据库迁移、无 Benchmark Card、无 apps/packages 重构。

首批信源采用使用者确认的「一手源＋独立实践」。条款、隐私说明、联系方式、域名与模型预算待运营者确认；模板不代表已生效条款。

## v0.1 本地检查（2026-10-08）

- Web 生产构建成功；现有 16 项 Web 测试全部通过。
- 六类分类、25 个场景/能力标签、19 个 Topic 引用、12 个信源、两份 JSONL 示例和 27 份提示词渲染检查通过。
- 12 个信源 XML 已下载并通过生产 RSS/Atom 解析器的本地 HTTP 回放，标题、绝对链接和日期均有效。这是解析兼容性验证，不等同于生产 worker 采集成功；当前受限环境的 guardedFetch DNS 无法直连，未修改其网络安全边界。
- 本地 typecheck 仍因 `/proc/self/exe` 环境限制失败；最终 typecheck、PostgreSQL 测试、API/MCP smoke 与 Docker Compose 以分支 CI 为准。
- 两处最小框架修复：API 分类默认值从旧 `tip` 改为配置首项；publication 移除旧 `tip/opinion` 合并特例。现有测试同步使用新分类；CI 按源配置检查种子数量，并验证 api/db/web/worker 都在运行。
- 未新增数据库字段或迁移。未提交 `.env`、密钥、私有数据或模型回执。
