# Gold set 与 selection calibration

## v0.1 的边界

保留 T1=60、T1_5=65、T2=76、understandFloor=50，以及原有七类、五轴权重和两次独立评分。提示词已改，原阈值尚未在 Agent Evaluation 上校准，不能宣称精选质量已达标。代码测试只验证流程和接口；本地模型替身不能证明提示词实际有效。

`industry/gold.example.jsonl` 的 8 条和 `relation-gold.example.jsonl` 的 6 对均为明确标注的虚构示例，只演示格式和边界，不作真实准确率、验收集或自动发布内容。用户标注的数据放 `.data/`，不提交正文和模型回执。

## 采样与标注

1. 首轮收集 200 条真实材料，跨 12 个源、六类内容、十个场景、三档信源与中文/英文。100 条按时间窗口随机采样代表真实分布，100 条覆盖困难边界；分开报告两部分指标，避免难例集比例扭曲线上质量估计。
2. 必须包含泛 Agent 产品 PR、无设置的 SOTA、只接入模型、普通维护更新、重复发布、短而有价值的一手公告、低热度研究、负面结果、grader 漏洞、污染、真实部署复盘、纯静态问答评测、证据不足但相关的论文摘要和 Prompt injection 材料。
3. 两名目标读者分别标 `select/reject/either`，并在单独标注表记录相关性、价值理由、证据不足点、场景/分类与信源档位。先独立后仲裁；`either` 不计入准确率，但报告占比。本文不替代人的阅读判断。
4. 按事件分组划分约 140 条 development、60 条 holdout；同事件的官网、转载、翻译及版本直接进展不能跨两组，以免泄漏。留出集冻结，调提示词时不看它。保留未采入训练提示词的新时间窗口作为最终检查。

## 运行与比较

在单独的开发数据库配置模型与预算；真实模型评测需要运营者提供密钥并确认预算。不要在 CI 打开付费调用。模型、prompt hash、样本集版本与采样种子固定记录。

```bash
node --env-file=.env scripts/eval-selection.ts --gold .data/gold.jsonl --split development --n 200 --label agent-eval-v0.1-baseline
node --env-file=.env scripts/eval-selection.ts --gold .data/gold.jsonl --split holdout --n 200 --label agent-eval-v0.1-holdout
```

先检查预筛漏召回，再看精选 precision/recall、误选与漏选，按场景、内容类别、T1/T1_5/T2、来源与语言分析；候选配比改变时不要只看整体 accuracy。精选 precision 优先，但不能以压掉论文、负面结果和小众方法换取表面准确率。专业价值标签和热度证据分开标注，不能用转发数当 gold。

先修改价值例子和噪声上限，保持权重与阈值；每次只做可归因的改动并比较开发集错例。若错误集中在阈值附近，再依据脚本自带的 40–90 门槛扫描提出分档阈值建议。任何阈值修改都应附分档混淆矩阵、precision/recall、样本量与置信区间，并由运营者确认；不能只为让精选数量变多而降低门槛。

建议上线门槛由运营者确定，例如对 precision 的期望和最低可接受 recall；60 条留出集不足以对细分场景作强结论，需说明区间和样本不足，不承诺虚假的精确百分比。上线初期逐条人工看精选，每周收集误选/漏选并追加未来时间段样本。

## 归组单独评测

另采 80–120 对真实报道，覆盖四类关系，特别增加「同 Benchmark 不同实验」「同实验多语转述」「版本/预算改变」「独立复现」「污染披露和回应」。事件级隔离 development/holdout。

```bash
node --env-file=.env scripts/eval-relations.ts --gold .data/relation-gold.jsonl --split development --n 120 --seed 7
node --env-file=.env scripts/eval-relations.ts --gold .data/relation-gold.jsonl --split holdout --n 120 --seed 7
```

检查四类 precision/recall/F1、混淆矩阵，以及 SAME_OCCURRENCE 的错误合并率。此脚本只测 pairwise judge，不测候选召回全链路；还要人工抽查事件页、重复曝光和独立来源热度计数。不要同时修改 selection threshold 和 grouping confidence threshold 来掩盖错误。
