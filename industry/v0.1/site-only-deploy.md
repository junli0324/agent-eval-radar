# 先让网站持续可读，再单独开启自动处理

在已有仓库根目录，将根 Compose 与 `industry/v0.1/compose.site-only.yml` 一起使用。适用于本地阅读，也可作为以后服务器的默认运行方式。服务器的 Docker 服务常驻后，浏览器访问网站不依赖维护者自己的电脑；本地 Docker Desktop 的运行仍依赖本机开机。

## 默认启动阅读站点

```powershell
docker compose -f docker-compose.yml -f industry/v0.1/compose.site-only.yml up -d --build
docker compose -f docker-compose.yml -f industry/v0.1/compose.site-only.yml ps -a
```

首次运行前按 README 初始化 `.env`，已有环境保留原文件。预期长期运行的是 `db`、`api`、`web`，`setup` 完成后退出。API/Web 的采集、模型与外部通知阀门由此配置固定为 false，即使 `.env` 中有旧的 true 值也保持关闭。网页、资料、报告、RSS 和 MCP 继续读取已有公开数据。

worker 放入 `automation` profile，默认 `up` 不启动它。[Docker 的规则](https://docs.docker.com/compose/how-tos/profiles/)允许显式指定服务时启动未启用的 profile，因此另加启动拒绝入口：只用上述配置执行 `up worker` 或 `run worker` 时，worker 会在加载数据库和队列前以 `site-only-worker-disabled` 退出，且不自动重启。

这项保护需要带上 `compose.site-only.yml`；根文件独立使用时仍保留上游普通 worker 语义。日常启动、重建和服务器运维使用本页命令。

需要定时检查与本地备份时，再叠加 [compose.maintenance.yml](local-maintenance.md)。它默认启动独立维护服务，仍不启动内容 worker。已启用维护的站点，后续重建 API 时也带上该配置，保留后台状态的只读挂载。

## 更新与状态检查

先按[备份说明](backup-restore.md)保留备份，再拉取开发分支。当前无迁移更新可以仅重建 API/Web：

```powershell
git pull --ff-only origin feat/agent-eval-v0.1
docker compose -f docker-compose.yml -f industry/v0.1/compose.site-only.yml up -d --no-deps --build api web
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/auto-trial.ts status
node scripts/smoke.ts --base http://localhost:3000
```

有迁移的后续版本按对应升级说明先备份、迁移，再更新服务。只有阅读服务运行时，受限 worker 心跳不应被当作持续抓取证明；后台状态与 `ps -a` 交叉核对。到期后网页仍可读，文章和报告可能没有新内容，这不代表服务离线。

## 已单独授权的自动试运行

未来确认新运行窗口、范围与预算，并完成[受限试运行准备](auto-trial.md)后，最后叠加既有 `compose.auto-trial.yml`：

```powershell
docker compose -f docker-compose.yml -f industry/v0.1/compose.site-only.yml -f industry/v0.1/compose.auto-trial.yml up -d --no-deps worker
```

根文件与受限文件仍共同使用；最后一份配置把 worker 的拒绝入口替换为受限入口，并仅对 worker 打开所需阀门。API/Web 继续保持关闭。受限 worker 验证模型、授权时段和预算，原有到期保护和共享 5/30/100 请求限制继续生效。

本页的启动命令不是下一轮付费授权。现有已到期试运行保持原状态，不通过更新、重启或改 profile 自动延期。

## 服务器迁移时补齐

1. 用运营者自己控制的持久在线设备承载 Docker，迁入已验收的数据库备份与上传文件，环境密钥在目标机器单独配置。
2. 确定实际访问地址，配置 HTTPS 和 `SITE_URL`，确认联系方式与使用规则后再对外开放。
3. 用独立维护服务持续检查并生成本地备份；再落实异地副本、长期保留策略和外发故障通知。已有本地恢复演练不能替代异地副本，普通 worker 中的备份任务不用于仅浏览运行。

这些可以在选定服务器后按实际环境完成；当前代码、内容质量和只读运行方式可继续本地验收。
