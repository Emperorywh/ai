---
id: TASK-008
title: 建立证据驱动审核与风险账本
---

## 任务描述

### 可验证结果

独立 Reviewer 能针对同一 CandidateIdentity、同一 verification set 和完整 criterion/risk 输入产生逐条可审计结果；Risk ledger 保持 append-only，未处置 material risk 必然阻止批准。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 9.5、10.5、11、16.2、20.4 和 21 节。
- TASK-003 的 requirement coverage。
- TASK-004/005 的 artifact 与 CandidateIdentity。
- TASK-006 的 Reviewer/Advisory execution 契约。
- TASK-007 的可信 VerificationRecord。

### 输出

- CriterionDisposition、ReviewFinding、CandidateReview request/outcome 和 raw/normalized decision 的 strict 契约。
- approved/rejected/request_input 的跨字段归一化规则。
- Worker/Reviewer/Verification/Operator RiskClaim、append-only RiskLedger、current disposition 和 waiver 引用契约。
- Reviewer 输入 envelope，包含冻结合同、候选、证据矩阵、历史 findings 和精确未处置风险。
- Diagnostic Reviewer 与 Blocker Auditor 只读 advisory 结果规则。
- stale、漏项、伪造 risk/disposition 和审核 workspace 越界测试及 ADR。

### 实现约束

- 每个 criterion 必须有 disposition；command 只能引用 VerificationRecord，static 才由 Reviewer 判断。
- approved 不允许 questions、新 verification request、critical/high/medium finding 或未处置 material risk。
- 新 Reviewer finding 先成为新 RiskClaim，本次 review 不能同时伪造其 disposition。
- Risk ledger snapshot 对 claims/disposition history 逻辑 append-only；current 索引由宿主构造。
- 候选改变后旧 disposition 保留历史但退出 current；duplicate/waiver 必须满足 SPEC 绑定规则。
- Reviewer 只读 clean workspace，不继承 Worker settings/skills/MCP/写权限。
- Advisory 只给建议或外部阻塞判断，不能直接 approved/blocked/转换 scope。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：对同一候选与 verification set 逐条 disposition 并完整处置输入风险，验证 normalized approval。
3. 正常路径：验证新 verification request 转回验证，完成后必须启动全新 Reviewer。
4. 异常路径：验证 stale candidate/set、criterion 漏项、`approved + questions`、未知/重复 risk、假 duplicate、ledger 删除历史和新增 finding 同轮处置均被拒绝。
5. 安全路径：验证 Reviewer/Advisory 不能读取主工作区、RunState、artifact 根或用户目录，也不能修改候选。

### 完成标准

- Reviewer 和 Risk ledger 结果可从冻结输入完整重建并 strict 校验。
- 全部自动化验证通过，可信 verification 和 CandidateIdentity 绑定未被削弱。
- 不存在摘要替代原始决策、隐式风险清除、Reviewer 自签 system evidence 或 Advisory 直改状态。
- 审核执行、结果归一化、风险账本、workspace 和状态转换职责分离。
- 可创建独立 Git checkpoint，并进入人工验收与完成证书建模。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除 evidence-driven review、risk ledger 和 advisory 规则，不删除可信验证、会话或候选契约。
