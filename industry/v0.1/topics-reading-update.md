# 第一步：主题目录与六篇十月资料发布

本轮先完善阅读入口。主题目录从 `industry/topics.json` 的分组读取 Agent 场景、情报分类、研究机构，文案在 `industry/topic-page.ts`；已有精选和待补充主题明确区分。空主题页提供其他主题与全部内容入口。原页面把上游三组标题写死，无法仅通过行业包改变，因此对 `apps/web/app/routes/topics.tsx`、`topic.tsx` 做小范围配置接线。Web 类型检查的 module 改为 ESNext 以支持 JSON import attributes；仍然不输出代码，运行时构建继续由原有 Vite 负责。不重构应用。

六篇已分析的十月材料沿用同一审核发布器，新增 `--review=october` 选择本次计划；原命令保持兼容。修正范围是标签与摘要：评分器缺陷不标为评测污染；Kolab 的协作任务不直接标为 Generalist Agent；BizBench 不把对比模型厂商当核心主体；Anthropic 报告保留原评测结果分类并对齐首标签，限定厂商自述，去掉不确定的工具长度限制解释。原评分和精选判定不变，不重新调用模型。

发布器校验原分析文本指纹、材料版本、分类首标签一致性和有效公开文字；整批事务，失败回滚；遇到不同人工编辑停止；重复执行不重复写审核日志。不改材料日期、补录标记和原始分析。

## Windows 操作

先确保 Docker Desktop 和 Bitz Net 开启。Web 有改动，这次需要构建镜像；数据卷和 `.env` 保留。

```powershell
cd D:\Projects\agent-eval-radar
docker compose stop worker
git -c http.proxy=http://127.0.0.1:7897 -c http.version=HTTP/1.1 pull --ff-only origin feat/agent-eval-v0.1
docker compose build
docker compose up -d --no-deps --force-recreate api web
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/publish-coverage-final.ts --review=october
```

正常结果为 `published: 6`、`modelCalls: 0`、各条 `publicTextOk: true`。全部成功且之前 34 篇仍在时，试用库达到 40 篇（36 精选、4 普通），这不是全站所有采集材料的数量。精选可能需要几分钟释放，主题计数也有缓存。

访问 http://localhost:3000/topics 查看分组、分类与场景主题。继续用只读检查获取具体缺口：

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/page-coverage.ts
```

它只读现有公开 API，输出全部文章数、六类文章数、每个主题精选数、热点条数与返回的报告期数；不读内部密钥、不写数据库、不调用模型。主题统计可能包含尚未释放的精选，请等释放和缓存更新后核对。报告期数是索引当前返回数量，不声称数据库总量。

## 后续页面分别补什么

| 页面 | 填充条件 | 下一步 |
|---|---|---|
| 首页、全部内容、分类 | 已公开且到释放时间的文章 | 本轮六篇先落地 |
| Topic | 有相应标签的已公开精选 | 按只读检查中的空主题定向选题，优先补 Multi-Agent 等缺口 |
| 热点、事件详情 | 近期材料、归组、真实传播证据 | 有限量验证事件链，不用历史论文或专业评分造热度 |
| 日报、周报、月报 | 报告时间窗内的非补录精选 | 近期自动链路验收；不把历史补录改为今日新闻 |
| 收藏 | 读者实际收藏 | 通过文章上的收藏操作使用 |

本轮不启动持续 worker，也不批量新增候选；先确认现有内容能在正确入口找到。
