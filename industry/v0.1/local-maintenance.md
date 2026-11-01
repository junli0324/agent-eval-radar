# 独立的站点检查与本地自动备份

`maintenance` 是独立维护服务：检查网站及数据库可达性，复用[快照备份工具](backup-restore.md)生成本地数据库和上传文件备份，不加载内容队列、采集器或模型处理器。仅浏览或原授权到期后也能运行，无须为备份启动普通 worker。

## 行为与存储

- 网站正常时每 5 分钟读取一次 `/api/health`，同时要求接口确认数据库正常；网站异常时每 30 秒复查。仅在状态变化时写日志，后台状态保持更新。
- 第一次运行备份一次；之后从上次成功算起，每 24 小时备份。时间记录持久化，重启不会立即重复生成。备份失败等待 1 小时再试；期间继续检查网站。
- 读取上传数据时只读挂载 `/data`；备份落到宿主机目录，默认是仓库下的 `.data/managed-backups/`，可以用 `RADAR_BACKUP_DIR` 指定另一目录。状态在独立 Docker 卷中，API 只读访问。
- 沿用同一数据库快照、文件指纹和归档校验；失败目录不视为成功，不自动删除已有备份。后台读取不调用模型、不改数据库，也不增加启动按钮。
- 同一数据库只允许一个维护实例持有会话锁；数据库会话变化后退出并重新取得锁。源数据库只读；维护状态和原始回执分开，不写入新的数据库结构。

宿主目录备份是本地副本；同机磁盘损坏仍会影响它。异地上传和自动清理尚未接入，当前保留所有恢复点；这不等于已经落实异地灾备或长期保留策略。

## Windows 本地启用

在已有项目根目录，先建立宿主目录，再使用三份配置：

```powershell
New-Item -ItemType Directory -Force .data/managed-backups | Out-Null
docker compose -f docker-compose.yml -f industry/v0.1/compose.site-only.yml -f industry/v0.1/compose.maintenance.yml up -d --build
```

日常长期运行预期是 `api / db / web / maintenance`，内容 worker 仍停止。维护服务只取得数据库连接所需变量，不继承模型提供商密钥。原 `.env`、预算、授权和模型回执均不修改。

维护镜像使用 node 用户（当前 UID/GID 为 1000）。Linux 主机应先创建一个仅用于本项目备份的新目录，并赋予该用户写权限。例如在仓库根目录准备默认目录：

```bash
mkdir -p .data/managed-backups
sudo chown 1000:1000 .data/managed-backups
chmod 700 .data/managed-backups
```

目录须预先存在；配置不会让 Docker 自动创建一个权限不明的宿主目录。自定义路径时，权限设置也仅针对明确的备份目录。备份含私有数据库内容，不提交到 GitHub。

## 看状态

登录 `/admin/runs`，新增“站点与本地备份”卡片显示最近检查、最近成功备份、上次尝试和下次备份检查时间。超过 10 分钟没有状态更新显示维护服务离线；超过正常备份间隔且超过重试余量仍无成功副本时提示处理。无记录或状态文件不可读不会显示成功。

```powershell
docker compose -f docker-compose.yml -f industry/v0.1/compose.site-only.yml -f industry/v0.1/compose.maintenance.yml logs --tail=30 maintenance
docker compose -f docker-compose.yml -f industry/v0.1/compose.site-only.yml -f industry/v0.1/compose.maintenance.yml exec -T maintenance node industry/v0.1/maintenance.ts status --require-healthy
```

状态查询只读；健康时退出码为 0，离线、异常或尚无成功备份时非 0，便于服务器运维接入。`once` 会检查并按当前计划决定是否备份，仅供维护服务已停止时显式执行；常规使用 `run`。维护成功仅代表本地备份生成和完整性检查，不代表已完成每次备份的独立恢复演练。

关闭页面没有系统推送。本阶段通过后台、Docker 健康状态和日志查看异常，外发告警另行接入。本地电脑关机或 Docker 停止时维护也会停止；部署到常驻服务器后才独立于本机。

## 本阶段验证

单元回归覆盖备份间隔、重启跳过、失败退避、状态过期、损坏状态恢复、阀门检查及敏感错误不出现在日志/状态中。隔离 Compose 验证了非 root 写入、上传卷只读、API 状态卷只读共享，以及维护实例重启不增加备份。

隔离维护服务自动生成的备份已恢复到独立 `*_ci` 数据库，61 张表的集合、行数和数据指纹一致，0 上传文件；新站尚未初始化内容队列，后台也能只读显示空队列。CI 另加入含测试上传文件的实际归档检查。虚拟上传不是用户真实上传，工程检查不等于长期在线稳定性或异地恢复验收。
