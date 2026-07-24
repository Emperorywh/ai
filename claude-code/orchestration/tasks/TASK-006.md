---
id: TASK-006
title: 冻结可恢复 Agent 会话与进程契约
---

## 任务描述

### 可验证结果

系统拥有 SDK 无关的 Worker session、epoch、turn、Agent process lease、协议事件、结构化 Reviewer/Advisory 执行和 transcript 观察契约，能够表达多轮、恢复、中断、送达歧义与 quiescence。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 6.2、8.3～8.4、9.1～9.3、11.3、12、16 和 20.2 节。
- TASK-004 的 immutable artifact/receipt。
- TASK-005 的 CandidateIdentity。
- 当前统一 AgentExecutor、一次性 prompt/outputFormat 和 implementation/repair/resume attempt。

### 输出

- Worker logical session、process epoch、单 in-flight turn、activity level state、telemetry 和有界历史引用的 strict 契约。
- Agent process lease 的 allocating/running/stopping/stopped 生命周期与精确 inspect/terminate 结果。
- streaming WorkSession、Candidate Reviewer、Diagnostic Reviewer、Blocker Auditor 和 history inspector 的 SDK 无关端口。
- init、result、idle/requires_action、background replace、task lifecycle、deferred、interrupt receipt 和 compact boundary 事件。
- crash-safe turn outbox、deterministic AgentControl receipt、quiescence 与 handoff packet 不变量。
- 非法组合、连续编号、历史边界和端口隔离测试及 ADR。

### 实现约束

- 应用层不得引用 SDK Query、SDKMessage、Hook 或 PermissionResult。
- 一个 scope 默认一个 Worker session、最多一个 queued/in-flight user turn；普通反馈不得创建 repair session。
- 新 epoch 的 background/open task 集合从空开始，事件按 epoch 内 replace semantics 投影。
- 进程创建前必须有 allocating lease；不能证明旧进程树停止时禁止新进程。
- transcript observation 只提供观察事实，不能宣告业务 completed 或 UUID exactly-once。
- 完整 transcript 不进入 RunState；历史进入 artifact manifest，活跃对象有界。
- Reviewer/Advisory 使用全新只读 session，不能直接修改状态或候选。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：构造同 session 的多个 epoch/turn，验证编号连续、一次一个 in-flight turn、反馈复用 session。
3. 正常路径：验证 Reviewer/Advisory 使用独立 execution/process lease，且无 Worker 写能力。
4. 异常路径：验证跨 epoch background 合并、重复 in-flight turn、未知 lease、未停止旧进程、非法 handoff 和超出历史边界时被拒绝。
5. 恢复路径：验证 queued/send_started/delivered/completed/ambiguous 覆盖崩溃窗口且不可见 UUID 不会自动重发。

### 完成标准

- 会话、进程所有权、事件和 outbox 契约完整且无 implementation TODO。
- 全部自动化验证通过，前置 artifact 与候选身份未被破坏。
- 不存在应用层 SDK 泄漏、query 直接产生 TASK 终态、无 lease 进程或无限状态数组。
- Worker、Reviewer、Advisory、history 和 process ownership 职责单一。
- 可创建独立 Git checkpoint，并为验证与 v7 聚合提供稳定输入。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除新会话/进程契约和端口，不影响前置能力或当前 v6 Agent 执行。
