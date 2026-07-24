---
id: TASK-009
title: 建立人工验收与完成证据证书
---

## 任务描述

### 可验证结果

human/external criterion 只有在同一 CandidateIdentity 上按 procedure、expected 和 required evidence 明确签收后才满足；TASK/Integration completion certificate 与 final requirement evidence matrix 可从源 artifacts 确定性重建。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 7.1、9.7、14.2～14.4、15、17.1.1、20.4～20.6 节。
- TASK-003 的 requirement coverage/evidence policy。
- TASK-004/005 的 artifact/CandidateManifest/Identity。
- TASK-007 的 VerificationRecord。
- TASK-008 的 CriterionDisposition 与 RiskLedger。

### 输出

- 逐 criterion AcceptanceDecision、procedure results、evidence manifest、operator role 与 response schema 校验。
- 性能、政治/合规数据、视觉和一般 human/external evidence 的最低结构要求。
- TASK/Integration completion certificate 与 CompletionEvidenceBundle manifest。
- final requirement evidence matrix 的确定性构造与验证。
- certificate 与 CandidateManifest、verification/review/acceptance/risk/contract artifacts 的完整绑定。
- 缺项、stale、弱证据、非法 waiver 和篡改证书的自动化测试及 ADR。

### 实现约束

- 布尔 approve、自由文本或缺 required evidence 永远不能满足 human/external criterion。
- Acceptance 必须绑定完整 CandidateIdentity；Reviewer/Worker 不能代替 operator 签名。
- 拒绝、缺项或阈值失败生成反馈，不得转为隐式通过。
- final matrix 的 requirement 集合与 mandatory requirements 精确相等，所有 source artifact 必须可读、strict、通过且同 final candidate。
- material risk waiver 必须由 evidence policy 允许，包含范围、后果、角色和 evidence；不得覆盖不允许 waiver 的 mandatory failure。
- certificate/bundle 任一子 artifact 缺失或 hash 不一致即证据不完整。
- Integration 空提交也必须保留 final CandidateManifest/projected tree 证据。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：用完整 procedure/evidence 批准 human/external criterion，并与 command/static evidence 构建 TASK/Integration certificate。
3. 正常路径：从冻结 requirements 和源 artifacts 重建相同 final matrix/certificate hash。
4. 异常路径：验证空 approve、缺步骤/附件、阈值失败、错误 candidate/platform/schema、非法 waiver、未处置 material risk、矩阵缺/多/重复行均被拒绝。
5. 篡改路径：改变任一 Candidate/Verification/Review/Acceptance/Risk/contract artifact 或 TASK 顺序，验证证书无效。

### 完成标准

- 人工验收、final matrix、两类 certificate 和 evidence bundle 均可从源 artifact 重算。
- 全部自动化验证通过，前置 coverage、CandidateIdentity、verification 与 risk 规则保持一致。
- 不存在通用空清单、Agent 代签、自报矩阵、旧 trailer fallback 或弱证据降级。
- Acceptance、矩阵构造、证书验证、artifact 和 Git 提交职责解耦。
- 可创建独立 Git checkpoint，并为 durable operator interaction 和 v7 聚合提供完成证据模型。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除人工验收/矩阵/证书领域能力及测试，不删除 Reviewer、Risk、Verification 或 Candidate 合同。
