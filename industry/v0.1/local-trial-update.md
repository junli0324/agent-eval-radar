# Windows 本地试用：Inspect 信源修复

适用于已在 `D:\Projects\agent-eval-radar` 跑通 Docker、并使用 `feat/agent-eval-v0.1` 分支的站点。这里只更新本地试用，不购买服务器或域名，不需要提供任何 Key。

## 更新代码与镜像

在 PowerShell 执行。worker 始终保持停止；现有数据库卷保留。

```powershell
cd D:\Projects\agent-eval-radar
docker compose stop worker
git switch feat/agent-eval-v0.1
git pull --ff-only origin feat/agent-eval-v0.1
docker compose build
docker compose up -d --no-deps --force-recreate api web
```

如果 git 提示本地文件冲突，先处理冲突，不运行 reset/clean，也不覆盖 `.env`。不要执行 `docker compose down -v`，这会删除本地数据库卷。

## 显式升级已有信源

`sources.json` 不覆盖已存在的数据库记录，因此需要执行一次升级。脚本不请求外网、不调用模型；可重复运行。保留源 ID、人工启停状态、分级和权限；原始材料不会删除。手动导入的 Changelog 试用文章保留 ID、分析和回执，只修正原文链接与去重身份，避免下次采集重复。

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/apply-inspect-source-fix.ts
```

正常输出包括 `sourceId: rss-inspect-ai`、`modelCalls: 0`。第一次旧站升级 `changed: true`，重复执行通常是 false。如果提示 custom settings，说明后台配置已被人工改动；脚本会停止并回滚，不覆盖配置。

## 只采集，暂不分析

```powershell
docker compose exec -T -e COLLECT_ENABLED=true -e MODEL_CALLS_ENABLED=false api node scripts/collect.ts rss-inspect-ai
```

本次首次从新入口导入最多 5 版；已有的手动试用版本会去重，因此新增数量可能少于 5。后续每轮窗口最多 10 版，不会把整页数百版历史全部排队。可在后台信源页确认名称为 **Inspect AI · Changelog**。

采集会排队，但 worker 未运行，因此不会自动产生模型费用。这里的 `-e` 只对这一条 exec 命令生效，不开启后台持续采集或模型调用。以后恢复 worker 前，先确认 `.env` 中的安全阀和待处理队列；恢复时使用 `docker compose up -d worker` 使其使用新镜像。

## 内容验收仍待完成

摘要提示词已增加“读完整个版本再选重点”的规则，优先关注评分正确性、成功判定、样本完整性与轨迹，而不是机械取 Changelog 前两项。也不再用 Assets 数量等页面信息凑摘要。

代码更新不会自动重写现有文章。下一次人工选定单条重新分析后，才能验证新摘要是否改善；提示词版本变化可能产生新的模型费用。评分阈值、权重、精选与热门的划分均未修改，也不要求本条一定进入精选。
