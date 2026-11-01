# 本地备份与隔离恢复演练

用于服务器部署前确认“能备份，也能恢复成可读网站”。工具不续期、不改预算、不启动 worker、不调用模型；没有自动覆盖数据库的恢复入口。需要包含 `backup-drill.ts` 的镜像，以及 PostgreSQL 17 的 `pg_dump` / `pg_restore` 和 Linux `tar`（项目 Docker 镜像已包含）。

## 备份范围

- `public` 与 `pgboss` 表的数据指纹、行数，与 custom-format `pg_dump` 使用同一导出快照。数据库由 `pg_dump` 完整导出，指纹用于核对恢复后的表数据。
- `/data/uploads` 文件及 SHA-256；无上传时生成空归档。上传中的文件发生变化或遇到符号链接会拒绝完成备份；备份时暂停上传操作。
- `manifest.json` 记录 PostgreSQL 主版本、归档大小和校验值。只有完整成功才生成清单；失败的目录保留供本地排查，重试会新建目录。

不包含 `.env`、密钥文件、临时反馈截图、可再生成的 `ogcache` 或 TLS 证书。数据库自身含会话、内部回执等私有信息，备份仍应存放在受限目录；不要提交、贴到聊天或放进公开网盘。部署恢复还需运营者在目标机器单独配置环境变量，并按需要轮换会话密钥。

这是本地逻辑备份与完整性演练，不是自动异地备份、加密备份或时间点恢复。SHA-256 和表指纹用于发现损坏/漏还原，不证明备份未被恶意篡改。表指纹会扫描全表，当前小型资料库适用，数据量大后再评估耗时。

## 1. 创建本地备份

PowerShell 中进入实际项目目录，保持 worker 停止。不运行 `prepare` 或普通 worker。API 镜像更新方式见[可靠性改进](reliability-update.md)。

```powershell
cd D:\Projects\agent-eval-radar
docker compose stop worker
$backupJson = docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/backup-drill.ts backup --dir=/data/backups
if ($LASTEXITCODE -ne 0) { throw 'Backup failed; do not restore an incomplete directory' }
$backup = $backupJson | ConvertFrom-Json
$apiContainer = docker compose ps -q api
New-Item -ItemType Directory -Force .data/backups | Out-Null
docker cp "${apiContainer}:$($backup.directory)" .data/backups/
```

目录内应有 `database.dump`、`uploads.tar.gz`、`manifest.json`。复制到主机后再核对清单；仅在原数据库卷里留一份备份无法应对该卷损坏。工具不会上传云端或自动删除旧备份。

## 2. 在独立数据库恢复

以下名称只用于本次演练。若同名资源已存在，先核实归属，不能覆盖别人的容器或卷。`$backupDir` 改为刚复制的完整目录；假密码仅用于无宿主数据库端口的隔离测试容器。

```powershell
$backupDir = (Resolve-Path '.data/backups/agent-eval-替换为实际目录').Path
docker network create radar-restore-drill
docker volume create radar-restore-files
docker run -d --name radar-restore-db --network radar-restore-drill -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=radar_restore_ci --mount type=volume,source=radar-restore-files,target=/restore-files postgres:17-alpine
docker exec radar-restore-db pg_isready -U postgres -d radar_restore_ci
```

确认最后一步返回接受连接后继续；未就绪时稍后重试该查询。

```powershell
docker cp "$backupDir/database.dump" radar-restore-db:/tmp/database.dump
docker cp "$backupDir/uploads.tar.gz" radar-restore-db:/tmp/uploads.tar.gz
docker exec radar-restore-db pg_restore --exit-on-error --no-owner --no-acl -U postgres -d radar_restore_ci /tmp/database.dump
if ($LASTEXITCODE -ne 0) { throw 'Restore failed; do not start the test app' }
docker exec radar-restore-db tar -xzf /tmp/uploads.tar.gz -C /restore-files
if ($LASTEXITCODE -ne 0) { throw 'Uploads restore failed' }
```

只向新建的 `radar_restore_ci` 导入，不把生产库作为目标，不执行 `--clean`。仅使用自己创建并校验过的归档，不解压来源不明的 tar。

## 3. 在应用启动前核对数据

```powershell
docker run --rm --network radar-restore-drill -e DATABASE_URL=postgres://postgres:ci@radar-restore-db:5432/radar_restore_ci -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false -e AGENT_EVAL_RESTORE_DRILL=true --mount "type=bind,source=$backupDir,target=/backup,readonly" --mount type=volume,source=radar-restore-files,target=/restore-files,readonly --entrypoint node aihot-app industry/v0.1/backup-drill.ts verify --manifest=/backup/manifest.json --files-dir=/restore-files
```

预期 `verified: true`；验证只允许显式演练开关及 `_test` / `_ci` 数据库。会校验两个归档、PostgreSQL 主版本、表集合/行数/指纹和上传文件集合；不会写库。应用启动后心跳等会正常改变副本，必须先做这一步。

## 4. 检查恢复的网站

可以临时启动同镜像的 API/Web，数据库地址只指向 `radar-restore-db`，上传卷只指向 `radar-restore-files`，Web 仅绑定 `127.0.0.1:3301`。使用专用测试会话密钥和管理员密码，所有外部开关保持 false，不启动 worker，也不导入生产 `.env`。API 的 `API_HOST=0.0.0.0`，Web 的 `API_BASE_URL=http://radar-restore-api:3001`；两者位于上述隔离网络。

启动后运行：

```powershell
node scripts/smoke.ts --base http://127.0.0.1:3301
node scripts/mcp-check.ts http://127.0.0.1:3301/api/mcp
```

另打开一篇已知文章、正常日报与补录周报，确认摘要、人工修正和补录标记；原有空报告仍不应公开。不要把“首页返回 200”当作完整恢复成功。

## 本次演练结果

2026-11-01 完成收尾复核，备份快照时间为 2026-10-26T14:40:05.711Z：

| 项目 | 结果 |
| --- | --- |
| 数据库归档 | 2,069,164 字节，custom format，`pg_restore --list` 可解析 |
| 恢复完整性 | 73 张表的集合、行数和数据指纹一致 |
| 关键数据 | 249 原始文章、80 发布投影、11 存储报告、24 人工修正、22 信源、415 回执、7 设置、9 预算行 |
| 上传 | 当前没有上传文件；空归档恢复成功。非空上传完整性由测试夹具覆盖，不冒充真实上传验收 |
| 应用读取 | 隔离 3301 站点整站 smoke、MCP 契约、2026-10-22 日报及 2026-W42 周报通过 |
| 生产影响 | 未替换原库、未发布修订、未启动 worker、未改授权和预算；备份与验证工具 0 模型调用 |

本地原始归档及 JSON 结果位于开发工作区 `.data/`，未入库或上传 GitHub。73 张表的数据一致不代表 80 个发布投影、11 个存储报告均公开可读。

隔离资源用完只清理本次创建的容器、网络和卷，保留原始备份。不要执行原项目的 `docker compose down -v`。自动定时备份、异地副本和真实恢复时间目标仍需在服务器方案确定后单独落实。
