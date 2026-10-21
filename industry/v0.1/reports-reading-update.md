# 空报告修复与本地资料回顾周报

此前的报告索引有九条日期记录，但没有正文或引用，不能算已发布的可读报告。本次修复保留数据库记录，同时让报告列表、最新一期、前后期导航、RSS、sitemap 和站点统计跳过空记录。常规生成器没有合格材料时不调用模型、不保存空报告。已有正文或历史引用的报告继续保留。

这需要少量修改后端：原生成器会保存空记录，单改 `industry/` 无法统一修复公开出口。没有新增数据库字段、迁移或调整精选门槛。

## Windows 更新

在 `D:\Projects\agent-eval-radar` 的 PowerShell 执行，保持 Docker Desktop 和代理运行：

```powershell
git -c http.proxy=http://127.0.0.1:7897 -c http.version=HTTP/1.1 pull --ff-only origin feat/agent-eval-v0.1
docker compose stop worker
docker compose build api
docker compose up -d --no-deps api web
```

## 生成首份可读周报

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/reading-review.ts publish --week=2026-W42
```

成功返回 `status: published`、`entries`、`modelCalls: 0` 和路径 `/weekly/2026-W42`。打开 <http://localhost:3000/weekly/2026-W42>。

这份周报明确标注“资料回顾（补录）”，按原文发布日期整理北京时间 2026-10-12 至 2026-10-18 已公开、已释放的精选，最多十二篇。它逐字复用已有中文标题与摘要，按分类编排，附原文链接，不生成新的实验结论，不收费，也不把历史补录当成实时新闻。原文章日期、补录标记及精选评分保持不变。

重复执行返回 `already-present`，不会覆盖已有可读周报。若没有合格材料，返回 `no-eligible-materials`，不写空记录；可把 `publish` 换为 `preview` 查看候选。未结束的周不能生成。无 `--week` 时默认上一个完整周。

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/page-coverage.ts
```

覆盖率输出现在同时显示报告条数、含引用的期数和最近三期的标题与引用数量。日报、月报在没有合格内容时展示真实空状态，并提供已收录资料入口。后续接通稳定的新资讯流水线，再由常规 worker 自动生成实时报告；本步骤继续保持 worker 停止。
