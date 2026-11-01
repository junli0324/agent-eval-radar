# AgentEval Radar v0.1 验证记录

## 2026-11-01 委托编辑完成追加样本复核

- 按运营者明确指示，日常内容判断由开发助手完成，不再将 A/B 标注表作为用户待办。完整独立 gold 方案保留为更高强度验证方式，编辑自检不冒充独立人工评估。
- 核对冻结语料和 12 条 SHA-256，逐条检查官方摘要页，对 MUFFIN、群体从众、评估分区理论补读正文相关章节。结果为 6 条优先候选、5 条普通资料、1 条排除，理由见[追加复核记录](editorial-self-review-20261101.md)。参考摘要、标签及指纹仅保存在 `.data/editorial-self-review/`。
- 检查了完整案例覆盖、引用身份、既有分类标签及决定的一致性；未伪造 provider 分数，未直接发布尚无分析结果的 12 条候选。发现单模型双角色、受限推理实验、人机实验不完全匹配和投稿/公告日期语义等边界，均写入参考记录。
- 本轮仅更新编辑记录与工作方式文档，不修改生产规则、门槛、数据库或网页功能；项目付费模型请求为 0，真实 worker 仍已退出、原试运行到期、滚动 24 小时请求为 0。工程检查以当前提交的 CI 为准，内容判断不计作准确率验证。

## 2026-11-01 授权后的定点内容修订

- 用户确认后，六篇材料执行一批人工修正：P2NPCBench 移出精选、后台记录待复核；METR 及 APA/Dual Exam/CANNBot-CAKE/RIDAR 共五篇补充和纠正摘要，RIDAR 标题改为中性描述。原评分、分类、标签、日期、补录状态和预算不变。
- 新增 `quality-corrections.ts` 的 snapshot / preview / apply。显式最多 10 个 ID，校验原材料/分析/来源/投影/人工设置的完整指纹；只允许标题、摘要和移出精选。同事务发布、审计、ledger 更新，拒绝冲突人工设置；重复计划无新写入。修订前已重新备份。
- 全新恢复副本先验证六条修改与重复执行，全库指纹差异只涉及 `audit_log`、`editorial_overrides`、`pool_search`、`publications`、`selected_ledger`、`selected_state`。恢复站点逐条验证六篇详情、HTML 和精选同步快照；整站 smoke / MCP 通过。两份可读报告不引用这六篇，关联事件无已生成的独立综述，无需重写归档。
- typecheck、Web production build、20 项 Web 测试、Docker 镜像构建通过。首轮后端测试误将本地模型替身也禁用，定位后在无真实密钥、禁止外网的网络及另一全新 PostgreSQL `*_ci` 库重跑，226 项全部通过。新增回归覆盖整批回滚、来源/正文变化、人工修改保护、同步移除、幂等重试、禁止提升精选/改分和阀门检查。
- 预筛/评分提示词明确数据构建者与评测对象的边界，中文编辑规则补分母、资格和历史范围。权重、门槛与双评分机制保留；工程测试不证明提示词实际效果。
- 12 条尚未分析的 arXiv 材料已冻结成 A/B 读者空白标注包，原文仅保存在 `.data/`。尚无真实读者标签，事件级隔离和跨来源覆盖待完成，不能宣称独立 gold set 达标。
- 未启动付费采集、未续期、未扩大预算，未合并 PR 或部署服务器。只发布用户授权的本地内容修订；当前 head 的远端 CI 另查。

## 2026-11-01 备份恢复与内容抽检收尾

- 新增本地备份与只读恢复校验 CLI；使用同一数据库快照导出归档及表指纹，上传文件单独归档并校验，验证只允许显式演练开关和独立 `_test` / `_ci` 库。没有自动覆盖生产库、清理旧备份或云上传入口。
- 2026-10-26 备份快照在全新 PostgreSQL 17 副本恢复，11 月 1 日用新构建镜像再次校验：73 张表集合、行数与指纹一致，当前无上传文件；249 原始文章、80 发布投影、11 报告记录、24 人工修正和 415 回执保留。详情见[恢复记录](backup-restore.md)。
- 恢复副本启动独立 API/Web（本机 3301），整站 smoke、MCP 契约、已知日报/周报详情均通过；未启动 worker。原 3000 网站 smoke/MCP 也通过，真实试运行仍已到期，预算保持 5/30/100，滚动 24 小时请求为 0。
- 本地 typecheck、Web production build、20 项 Web 测试、新 Docker 镜像构建通过。独立 Linux/PostgreSQL 测试库完整 224 项后端测试通过；临时目录清理加路径检查后，备份回归单独再次通过。新增回归覆盖数据变化、缺表、归档篡改、多余上传、路径越界、演练开关和付费阀门保护。
- [20 条材料与报告抽检](content-quality-review.md)发现精选范围、历史限定及摘要信息缺失问题，整理人工修订清单，未自动改稿/撤稿。样本不是独立人工 gold set，不据此计算准确率。
- 备份、正文、回执和详细输出保留在忽略的 `.data/`；费用仍待提供商账单确认。本轮没有真实模型调用、预算变更、续期、合并或服务器部署；新提交远端 CI 需按当前 head 另查。

## 2026-10-26 第一批可靠性改进

- 摘要保存与视觉折叠分开：保留模型结果和末句限制，继续身份校验；已有理解回执仅做显式 ID 的只读修订预览，保留人工编辑。两篇真实资料预览恢复 99→265 / 86→207 字，未重新付费分析、未发布修订。
- 受限维护轮将报告放在文章和综述之前；每轮至多 3 篇文章与 3 个综述，额度耗尽保存建议恢复时间，后续轮次和重启继续退避，免费采集和热点计算仍可运行。共享预算、评分门槛、截止时间及历史队列边界不变。
- 后台增加管理员可读的受限状态概览，区分到期、主动停止、预算等待、异常离线、预算变更和普通 worker 入口异常；日报诊断复用生产候选和去重逻辑。请求不调用模型，不新增操作按钮，不做数据库迁移。
- 本地 typecheck、Web production build、20 项 Web 测试通过；独立 Linux 容器和全新 PostgreSQL `*_ci` 库中 223 项后端测试全部通过。新增回归覆盖报告顺序、批量、预算退避、到期优先级、身份校验、人工修改保护、后台鉴权及只读查询。测试只调用本地替身。
- 独立 Docker 镜像与 Compose 四服务、12 源种子、整站 smoke 和 MCP 检查通过。首次 smoke 早于 API 就绪，健康接口就绪后重新检查全部通过；浏览器核对[测试站截图](../../docs/assets/automation-status-preview.png)，截图使用虚拟数据与隔离开发身份。
- 上述工程检查和内容回放不代表已验收长期付费运行、独立 gold set、提供商账单或备份恢复。未续期、未增加预算、未向用户数据库写入，正式合并与部署仍待验收。

## 2026-10-25 到期复盘与 Windows 检查

- 核对现有工作区与远端开发分支均为 `7bcbcbb`，PR #1 为 open / draft，未合并 main；该提交的两个 [Check](https://github.com/junli0324/agent-eval-radar/actions/runs/39786398861) / [PR Check](https://github.com/junli0324/agent-eval-radar/actions/runs/39786390385) 均成功。本轮新增提交的远端 CI 需另查，不能沿用旧结果。
- 用户确认已重建并看到更新栏；Docker 就绪后，实际检查首页 HTML 含「内容更新」，更新接口正常返回近期标题。首次查询计数为零是基线行为，不能据此判断没有内容。
- 实际检查受限 worker 的启动命令来自双 Compose 配置，已记录 `trial-ended` 并正常退出。到期诊断通过数据库只读事务运行，不续期、不恢复旧预算、不启动普通 worker、不调用真实模型。费用仍需提供商账单核对。
- 新增 `trial-review.ts` 及数据库回归，验证请求尝试与逻辑回执、重试、截止边界、未知费用、分币种及实际/估算费用、发布门控、补录和空报告。新工具在本地真实库执行只读复盘成功；真实回执、内容抽检与状态快照仅保存在被忽略的 `.data/`。
- Windows Node 24.17 原生启动 Web 时发现绝对磁盘路径不能直接用于 ESM 动态 import；最小修复为 `pathToFileURL`。既有真实 Web 服务/缓存测试覆盖此启动路径。
- 本轮 typecheck、Web production build 和 19 项 Web 测试通过。221 项后端测试在独立 Linux 容器和全新 PostgreSQL `*_ci` 库全部通过，模型使用测试自带的本地替身，无真实密钥；Windows 的 SIGTERM 测试不适用于该平台的信号语义，完整后端验证使用与 CI 一致的 Linux 环境。
- 独立 Docker 镜像与 Compose 项目验证通过：四服务运行、12 个信源种子、整站 smoke、MCP 契约检查、无试运行配置时受限 worker 正常退出，以及新复盘 CLI 的 not-prepared 返回。测试端口 3300、独立数据库卷，与用户原 3000 站点分离。
- 保持现有评分门槛、热点证据规则、信源、付费预算与原试运行截止时间。未增加迁移，未向用户数据库写入或发布修订。工程检查不代表人工 gold set 或报告事实质量验收完成；后续顺序见 [只读复盘](trial-review.md)。

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

## v0.1 完整 CI 验收

- [Check #2](https://github.com/junli0324/agent-eval-radar/actions/runs/37804592935) 对提交 `8af7a136a73954c2e9610a35fc56968eed671c7e` 验证通过，2026-10-09 核实最终状态为 Success。
- `check` 成功（1m 17s）：typecheck、Web 构建与 Web 测试、PostgreSQL 迁移/Topic 种子、Web/API/RSS smoke、MCP 检查及现有后端测试。
- `docker` 成功（52s）：镜像构建、Docker Compose 启动、smoke、12 个信源种子数量校验，以及 api/db/web/worker 四个服务运行检查。
- 已核对 GitHub 开发分支与本地代码树完全一致；所有实现分阶段提交到 `feat/agent-eval-v0.1`。尚未合并 main、未部署生产站点。
- 工程验收不等于真实模型效果验收：真实采集、模型评分/归组/摘要仍须在提供密钥和预算后，用人工 gold set 验证。下一步见 `calibration.md`。
- 上线前由运营者确认域名、部署环境、模型与预算、联系方式，以及 `industry/pages/` 条款/隐私模板。
