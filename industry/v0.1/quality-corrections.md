# 有证据的定点内容修订

`quality-corrections.ts` 用于少量已经核验证据的标题、摘要修正、移出精选及移除无依据的能力标签。复用现有 `editorial_overrides`、发布投影和同步 ledger，不新增数据库结构。它不重新评分、采集或调用模型，不调整预算或授权，不自动重写报告/事件综述。

## 先冻结当前状态

保持 worker 停止，API 镜像应包含当前工具。在本地 PowerShell 中：

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/quality-corrections.ts snapshot --ids=文章ID1,文章ID2
```

最多 10 个明确 ID，输出每篇当前标题、摘要、标签、精选状态、评分与 `expectedFingerprint`。指纹覆盖已存原材料、分析、来源配置、发布投影和人工设置；不会输出原文正文或模型回执。只对已有、当前版本的可读公开材料修订。

按证据编写本地 JSON 计划，保存在被忽略的 `.data/`。格式：

```json
{
  "version": 1,
  "corrections": [
    {
      "articleId": "替换为实际ID",
      "url": "https://example.org/替换为原始链接",
      "expectedFingerprint": "替换为snapshot返回的64位指纹",
      "fields": { "summary": "已核验的完整摘要" },
      "reason": "说明原始证据、修正问题和限制"
    }
  ]
}
```

`fields` 只接受 `title`、非空 `summary`、`selected: false`。另可在单条计划的顶层写 `"removeTags": ["Generalist Agent"]`；仅移除现有场景/能力词表中的明确标签，不能新增标签、移除分类标签或实体。仅删标签时传 `"fields": {}`。

禁止提高精选、改评分、改分类或可见性。已有人工修正与目标字段冲突时停止，不覆盖；其他人工字段合并保留。若确实需要更改已有人工判断，先检查原因和当前版本再明确处理。

## 预览与执行

将计划复制到 API 容器的数据目录后，先 `preview`，核对整批的 before、目标字段和原因，再在授权范围内 `apply`：

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/quality-corrections.ts preview --plan=/data/quality-plan.json
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/quality-corrections.ts apply --plan=/data/quality-plan.json
```

执行前备份，见[备份与隔离恢复](backup-restore.md)。数据库里任一指纹不匹配或人工编辑冲突，整批不提交。写入和发布在同一事务中，保留审计前后值；验证评分、分类、日期、补录、资格与可见性不变，标签仅允许声明的移除，精选仅允许显式降低。相同计划重试会核对执行后的指纹并跳过，不重复新增审计或同步项；之后有新编辑则重新停止。

标题/摘要修正通过统一发布读取层到达详情、列表、API、RSS、MCP 与精选同步；移出精选产生 ledger remove。归档报告或已经生成的事件综述可能保存旧文字，执行者必须另外检查受影响引用，不能把重新生成它们视为已获得付费授权。网页缓存到期或刷新后核对实际文字和精选状态。

## 撤销与边界

后台可通过审计记录查看之前的人工字段与发布内容。撤销本次新加的人工字段时，仅清除本次对应的 title/summary/selected 等键，让原模型结果重新投影，并写明原因；不要清空其他人工设置或用整库恢复覆盖后续工作。数据备份用于故障恢复，不代替单条编辑撤销。

本工具不证明修订文字正确。仍须核对原文，区分作者自报、独立复现、指标分母、资格条件与历史范围。当前执行记录见[内容质量复核](content-quality-review.md)，独立读者标注与下一轮付费运行另行验收。
