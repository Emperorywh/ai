---
id: TASK-007
title: 冻结可信验证与 Runner 证明契约
---

## 任务描述

### 可验证结果

系统能够严格表达 Verification request/attempt/record、执行环境、workspace capability、宿主策略、依赖层身份和 Local/Remote Runner attestation；Worker claim 或人工日志在类型与规则上无法冒充 system verification。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 7、10、20.3 和 21 阶段 0 第 5 项。
- TASK-002/003 的 criterion、coverage 和宿主策略引用。
- TASK-004/005 的 artifact 与 CandidateIdentity。
- TASK-006 的 process lease 和长副作用分段契约。
- 当前 Worker 自报 `verifications` 且 Reviewer 无独立命令验证的现状。

### 输出

- VerificationRequest、ExecutionSpec、Attempt、Record、Environment、RunnerAttestation 和 execution handle 的 strict 契约。
- clean materialization、verification/reviewer/manual workspace capability 与 lease 生命周期契约。
- platform runner capability、environment/dependency/executable profile 和 dependency layer identity。
- system verification、tool observation、worker claim、operator attestation 的证据强度规则。
- nonce、policy、candidate、platform、record hash 和认证身份的 attestation 校验。
- 基础 fake 契约测试；不声明实际支持平台，不实现 OS Sandbox。

### 实现约束

- command criterion 只能由受信 Runner 对同一 CandidateIdentity 生成 passed system verification。
- execution 只允许结构化 package script/argv，不经 shell；所有 ID 来自冻结宿主策略。
- Runner 不拥有 Git；workspace provider 物化、核验和回收候选。
- 必要 command 只在 disposable clean materialization 产生门禁证据；active candidate 仅作诊断。
- Local/Remote 使用同一 attestation 形状；缺少任一绑定的远程结果只作外部附件。
- human/external 不能满足 command，targeted 不能满足 full/clean_platform。
- 实际平台/Sandbox/依赖供应仍待决策，不得用空 capability 规避。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：构造完整同候选/平台/policy/nonce 的 Local/Remote 通过记录，验证可成为 system verification。
3. 正常路径：验证 queued→running→completed/interrupted 及 start/collect/interrupt 分段。
4. 异常路径：逐项篡改 nonce、policy、candidate、platform、record hash、runner identity 或认证事实，验证拒绝。
5. 异常路径：验证 Worker claim、工具日志、人工日志、active candidate 和 targeted evidence 不能冒充相应门禁。

### 完成标准

- 验证、环境、workspace、host policy、依赖身份和 attestation 均有唯一 strict 定义。
- 全部自动化验证通过，前置候选与 process lease 规则保持有效。
- 没有 raw shell、Runner 持有 Git、人工降级、跨平台替代或未认证远程结果。
- 领域规则、Runner、workspace provider 和宿主策略来源边界清晰。
- 可创建独立 Git checkpoint，并为 Reviewer/Risk 建立可信证据基础。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除可信验证/Runner 领域契约和 fake tests，不回退前置能力或改变 v6 运行路径。
