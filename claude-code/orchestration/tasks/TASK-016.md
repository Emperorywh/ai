---
id: TASK-016
title: 证明 Runner 证据身份不可伪造
---

## 任务描述

### 可验证结果

Fake Local/Remote Runner 能证明 platform、nonce、host policy、CandidateIdentity、record hash 和认证身份任一不匹配时都不能生成 system verification；人工附件与 Worker/工具日志无法穿透证据强度边界。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 7.2、10.1～10.3.1、10.5、20.3 和 21 阶段 0 第 5 项。
- TASK-003 的 command criterion/host policy 引用。
- TASK-005 的 CandidateIdentity。
- TASK-007 的 verification/environment/attestation 契约。
- TASK-014 的 verification state revision 归约。

### 输出

- Fake Local/Remote Runner start/collect/interrupt 与可信通道 conformance。
- nonce、execution spec、policy、candidate、platform、record hash、runner identity 和认证传输逐项核验。
- running attempt 崩溃、遗留 execution 回收、interrupted 投影和更高 ordinal 安全重跑证明。
- Reviewer 补充 VerificationRequest 的结构校验、去重和重新执行证明。
- human/external、Worker claim、tool observation 与 system verification 隔离测试。
- Remote Runner 信任边界 ADR；不配置真实凭据或声明实际支持平台。

### 实现约束

- Fake Runner 只验证契约，不能作为生产 SandboxCapability。
- attestation 绑定完整 record 且避免循环 hash；未认证远程日志只作 external artifact。
- 状态投影幂等不等于命令 exactly-once；running 恢复先终止/确认遗留 execution。
- Reviewer 只能请求结构化 verification，不能直接签发结果或获得普通 Bash。
- platformId 精确匹配，当前宿主 evidence 不能替代其他平台。
- 不选择支持平台、不实现 OS Sandbox、不用人工日志替代能力。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：Fake Runner 签发 passed/failed/timeout/interrupted，验证 output hash、environment、attempt lifecycle。
3. 异常路径：逐项篡改 nonce、execution spec、policy、candidate、platform、record hash、runner identity 和认证事实，全部拒绝 system verification。
4. 异常路径：人工日志、Worker claim、tool observation、active candidate 和其他平台记录均不能满足 command。
5. 恢复路径：queued/running 崩溃后先回收 execution，再以更高 ordinal 重跑；旧晚到结果不覆盖新 attempt。

### 完成标准

- Local/Remote Runner 证据身份和恢复语义可由 conformance 完整证明。
- 全部自动化验证通过，CandidateIdentity、host policy、revision 和 evidence strength 未削弱。
- 没有未认证远程结果、人工替代 command、跨平台冒充、Reviewer 自签或 exactly-once 假设。
- Runner、可信通道、evidence validator、Reviewer request 和 reducer 职责分离。
- 可创建独立 Git checkpoint，并完成阶段 0 Fake Runner 证明。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除 Fake Runner conformance/ADR，不移除通用 verification 契约或其他 v7 基础。
