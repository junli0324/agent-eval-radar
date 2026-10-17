# Windows：建立可浏览的 Agent Evaluation 试用资料库

目标是先处理 10 篇，再扩至目录中的 30 篇候选。不是保证 30 篇入选精选。目录覆盖 Code、Browser、Computer Use、Terminal、客服、研究、记忆与安全；目前以论文和 Benchmark 为主，后续再补工具实践与观点。

这些是历史与近期资料的混合候选，不是最新排行榜或人工 gold set。脚本读取 arXiv 官方摘要页，核对论文 ID、标题和日期，只导入摘要，明确告知模型材料范围及作者报告属性。保留页面提供的首次发布日期（精度为日），摘要可能是更新后的版本；不据此断言某个结果最早出现的日期。不提交论文正文、用户数据库或密钥。

## 1. 更新代码和镜像

打开 Docker Desktop 和 Bitz Net，再在 PowerShell 逐行运行；任何一步失败先停止。

```powershell
cd D:\Projects\agent-eval-radar
docker compose stop worker
git switch feat/agent-eval-v0.1
git -c http.proxy=http://127.0.0.1:7897 -c http.version=HTTP/1.1 pull --ff-only origin feat/agent-eval-v0.1
docker compose build
docker compose up -d --no-deps --force-recreate api web
```

不改 `.env`，不启动 worker，不执行 `down -v`。有本地修改冲突时不要 reset/clean。7897 是本次用户的本地代理端口；代理端口改变时相应调整。

## 2. 导入最多 10 篇：不调用模型

```powershell
docker compose exec -T -e COLLECT_ENABLED=true -e MODEL_CALLS_ENABLED=false api node industry/v0.1/trial-library.ts import --limit=10
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/trial-library.ts status
```

核对 `body_status: ok`、标题、原文链接与日期。每次最多请求 10 个尚未存在的条目，间隔至少 3.5 秒。已有相同 arXiv ID 的文章（包括版本链接）跳过，不强行覆盖已有内容。已存在但不属于本批导入的文章继续使用原有管理流程。

遇到 HTTP 429 会停止，之前成功导入的文章保留；不要马上反复重试。摘要入口也可能限流，它不是绕过限流的办法。网络恢复后重跑即可继续下一条，不需要重建数据库。

## 3. 小批量分析：会产生模型费用，不自动发布

先试 3 篇，查看回执 token、提供商账单与摘要质量，再处理其余内容：

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=true api node industry/v0.1/trial-library.ts analyze --limit=3
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/trial-library.ts status
```

一次最多分析 10 篇，顺序执行。`--limit` 是文章数，不是模型请求数或金额上限；单篇包括多步骤调用，仍走现有回执和预算熔断。`cost: null` 表示费用未知，不是免费。脚本不会修改提供商余额、数据库预算、评分阈值或全局开关。

相同材料版本已有分析的文章会跳过，包括被 BLOCK 的文章；重复执行会继续下一批。中断后复用已有回执，不强制新 attempt。提示词更新不会让本脚本自动重评旧分析，重评仍需单独操作。不要同时启动 worker。

## 4. 审核并发布

检查 status 输出中的中文标题、摘要、标签与原文。重点排查：把模型评测误当成 Agent 评测、把知识检索误标为记忆、缺少成绩限定条件、夸大作者报告为独立验证。需要修正的文章先留待后台编辑，不要为凑数量降低门槛。

将确认好的文章 ID 用英文逗号连接，替换下面的占位内容（每次 1–10 篇）：

```powershell
docker compose exec -T -e COLLECT_ENABLED=false -e MODEL_CALLS_ENABLED=false api node industry/v0.1/trial-library.ts publish --ids=替换为确认过的文章ID
```

发布前检查所有 ID 均属于试用库、分析版本当前、相关性通过、有中文标题和摘要。发布仍走原有 publication 逻辑，保留人工覆盖与精选判定；不相关内容拒绝发布，相关但未达精选的内容可进入“全部”。整批不是数据库原子事务；如果发布中断，已成功部分保留，重跑可继续。

打开 <http://localhost:3000/all> 浏览资料库，再看首页精选和 Topic。历史资料按原日期排序，不能用“今天”过滤来验收数量。精选首次展示可能经过现有发布等待窗口，热门也不会因为手动导入就自动变热。

## 5. 扩充与验收

首批通过后重复导入、分析、审核、发布，直至 30 篇候选处理完。每轮查看 token 和费用，记录实际公开、精选、BLOCK 数，不承诺固定入选率。保存误筛和标签问题为开发样本，另建独立人工 gold set 再校准阈值。当前目录不能兼作独立测试集。

本脚本不启用长期自动采集。先连续试用几天，检查原文可访问、摘要可靠、分类和 Topic 有用，再决定是否开定时任务与购买服务器。
