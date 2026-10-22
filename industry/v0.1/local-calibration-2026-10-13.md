# 本地试用校准记录：2026-10-13

## 性质与边界

这是开发样本记录，不是 gold set 或独立 holdout，也不是准确率报告。证据来自运营者本地运行输出及提供的正文；编辑判断由开发助手提出，运营者明确了领域边界，但未对每篇做独立双人标注。来源的成绩声明未独立复现。观察到的结果均为本次提示词修正前；新规则的真实模型效果待复测。

核心对象是 Agent 的任务完成、执行过程及其评测方法/工具。使用 Agent 训练或测试基础模型，本身不构成 Agent Evaluation；生成—验证—改进的推理循环也不自动证明它是 Agent 评测。保留支撑 Agent 评测的 grader、任务环境和可靠性修复，不要求每篇都是榜单。

运行基线：开发分支 d50d2ab；运营者此前报告环境 LLM_MODEL=deepseek-flash，结果中的 model/scoreModel 多为 default（路由名，不是独立确认的供应商模型版本）。prompt hash、完整 provider attempts、费用未随本次输出提供，不推算费用。保留 T1=60、T1_5=65、T2=76、understandFloor=50，未改七类内容及评分权重。

## 样本与观察

| 样本/原文 | 运行前判断与后续裁定 | 已观察模型结果 | 问题与用途 |
|---|---|---|---|
| [GPU scheduling](https://huggingface.co/blog/allenai/impactful-scheduling) | 根据正文预览预期 BLOCK，未收到全文 | BLOCK，理由为 GPU 资源调度而非 Agent 评测 | 明显负例候选；不能声称已完整人工核验 |
| [Falcon ASR](https://huggingface.co/blog/tiiuae/falcon-asr) | 根据正文预览预期 BLOCK，未收到全文 | BLOCK，理由为语音识别而非 Agent 任务评测 | 普通模型指标不等于 Agent Evaluation |
| [Inspect AI 0.3.277](https://github.com/UKGovernmentBEIS/inspect_ai/blob/0.3.277/CHANGELOG.md) | 相关、倾向不精选；此前已看过旧模型输出 | PASS，22/22，阈值 60，未精选 | 摘要补入评分/样本修复，但仍先写一般日志问题；不是盲标样本 |
| [ML Intern](https://huggingface.co/blog/building-with-ml-intern) | 初判 PASS/倾向不精选；讨论领域边界后修正为 BLOCK 可接受 | BLOCK，理由为用 Agent 训练小模型、非 Agent 能力评测 | 初判曾把 smoke test/预算约束泛化为 Agent 评测；保留判断修订过程，不能事后算作预判正确 |
| [Nemotron IOI/IMO](https://huggingface.co/blog/nvidia/nemotron-ioi-and-imo-2026) | 初判 PASS/倾向精选；领域澄清后改为待裁定，不作确定正例 | PASS，71/71，阈值 65，精选 | 需确认推理系统是否属于站点的 Agent 评测范围；Generalist Agent 无充分依据；摘要漏 IMO 结果；未发布 |
| [τ-bench v1.0.1](https://github.com/sierra-research/tau2-bench/releases/tag/v1.0.1) | 完整正文、运行前预期 PASS/精选 | PASS，88/88，阈值 60，精选 | 摘要只有泛化修复和跨版本限制，缺少误罚额外验证读取、重评机制；未发布 |
| [τ-bench v1.0.0](https://github.com/sierra-research/tau2-bench/releases/tag/v1.0.0) | 完整正文、运行前预期 PASS/精选 | PASS，88/88，阈值 60，精选 | 摘要漏语音打断、噪声、97 个银行任务；“记忆”缺少依据；未发布 |

两次评分相同不是独立人工验证或置信区间。以上样本不得用于宣称 100% 准确或精确率达标。LiquidAI d1 仅提取了正文，未完成标注和模型分析，不计入上述结果。

## 正文版本指纹

仅保存对运营者提供的解析后 body_text 原样 UTF-8 计算的 SHA-256，不保存文章全文、回执、密钥或数据库导出。网页可能更新；复测前应核对本地正文指纹。字符数按 Python len，不能替代字节数。

| 样本 | 字符数 | SHA-256 |
|---|---:|---|
| ML Intern | 10228 | 984d0b6c87dcfa403fe83615fd8f6c8754009eed7bbafc0d8bc0e3c7ae67fea7 |
| Nemotron | 6591 | fb6b51811f309f41fc30209342c7dd44ab5b60edb638694d93389397eb82f3a8 |
| τ-bench v1.0.1 | 6017 | fa85f4575ba0827efaa279c3d6d74e6058e128efcdd0490f495122f1db925928 |
| τ-bench v1.0.0 | 4567 | c10b02269a94beb69f2e79cd579082df8f53d16f48e2f0397bd9f0aeff6306ff |

其他三篇缺少本次完整正文附件，未补造指纹。完整证据与回执继续保存在本地数据库，不提交到公开仓库。

## 本轮修正与验收

只修正摘要与标签提示词；不修改 prefilter、selection-score、阈值、数据库或信源。共用标签证据规则供理解与结构化使用；长文摘要要求具体机制和必要边界，避免标题复述。没有把本轮样本的标准答案硬编码进生产提示词。

仅对两篇 τ-bench 在同一正文、模型配置下各复测一次，记录新旧 prompt hash 和回执。验收条件：

- v1.0.1 摘要必须解释额外验证读取曾导致误判，保留 banking_knowledge 跨版本不可比；如提及分数，说明来自重评而非能力提升，不把 task_074 的标准答案修正归为只涨不跌；pass^k 不写成 Pass@k。
- v1.0.0 摘要至少包含一个具体语音条件（打断/重叠发言/噪声）和检索加交易工具调用任务；有篇幅可保留 97 个任务或 698 份文档，不要求堆全部数字。
- 不因知识检索贴“记忆”，不因供应商/托管平台贴主体标签；客服场景可用 Customer Service Agent。标签少比无证据标签好。
- 2–3 句覆盖具体贡献和限制，不编造机制、日期或独立验证；专业价值与传播热度分开。
- 修改提示词后旧分析不自动重算，也不自动发布。复测后先检查，再发布；工程测试通过不代表上述语义验收通过。

通过后补充未用于调整提示词的新事件和新时间窗口，按 [正式校准计划](calibration.md) 建立事件隔离的开发集与留出集；两篇同一 Benchmark 的版本更新不能拆到开发/留出两边。

## 信源待办

- arXiv 本次 HTTP 429，暂停连续重试；原因尚未确认。
- OSWorld 本次 found=2/created=0，但 source_id 下无文章。不能解释成该信源已有文章；需排查时间窗口、过滤和跨源去重。
- 全局 worker 继续停止。摘要规则更新不需要再次执行 Inspect 信源迁移，也无需重采这些正文。
