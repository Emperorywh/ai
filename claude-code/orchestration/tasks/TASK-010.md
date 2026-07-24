---
id: TASK-010
title: 建立持久人工交互与延迟权限状态
---

## 任务描述

### 可验证结果

Worker、Reviewer 或验收流程需要外部事实时，系统能够形成唯一、可回答、可恢复的 durable request；普通回答、验收决定和 deferred permission 都有明确生命周期，只有 operator 明确 cannot_provide 才能形成 blocked 事实。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 5.2、8.6、9.6～9.7、12.3、13、16.3、19 和 20.1/20.2/20.4 节。
- TASK-004 的 response/attachment artifact。
- TASK-006 的 session/turn/process lease 与 live callback 边界。
- TASK-009 的 AcceptanceDecision 与 evidence schema。
- 当前 Reviewer blocked 直接形成终态且没有 `respond` 协议的现状。

### 输出

- DurableOperatorRequest、DeferredToolState、PauseState、resume stage 和 response 类型的 strict 契约。
- preparing→pending→answered→consumed 的普通交互，以及 deferred decision_dispatching→effect/denial observed→consumed 生命周期。
- Blocker Auditor 结果到正式 request/cannot_provide 的领域规则。
- `respond` 输入校验与“只保存回答、不恢复 workspace、不启动 Agent”的应用契约。
- secret-safe 摘要、附件复制/hash 和 credential_ready 语义。
- 双 request、非法阶段、deferred 崩溃和 blocked 误判测试及必要 ADR。

### 实现约束

- 同一 Run 最多一个未消费 request；所有可变交互状态只在 RunState，正文/附件在 immutable artifact。
- preparing 不派生 awaiting_input；answered 在目标阶段真正消费前仍是 awaiting_input。
- PauseState 不表示可回答问题，pause 优先于 answered request 的状态派生。
- live `canUseTool`/dialog/elicitation callback 不能跨进程持久化；无法即时回答时取消并转普通 durable request，新 turn 重试。
- deferred allow 只匹配同 session/epoch/toolUseId/tool/inputHash，并先 checkpoint decision_dispatching。
- 工具 secret 输入、token、密码和私钥不得进入状态或命令行；credential_ready 只记录外部已安全配置。
- blocked 必须有 operator cannot_provide，预算、认证、超时和可修复错误不得转 blocked。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：验证外部事实 request 从 preparing 到回答、恢复目标 stage 后消费；验收决定按 schema 投影。
3. 正常路径：验证 deferred allow/deny 经 decision dispatch 和真实 effect/denial observation 后才 consumed。
4. 异常路径：验证双未消费 request、错误 requestId、非法 response schema、secret 持久化、callback 重绑和 deferred identity 不匹配均被拒绝。
5. 状态路径：验证 pending/answered 派生 awaiting_input，pause 与 cannot_provide 分别派生 paused/blocked，其他问题不会误写 blocked。

### 完成标准

- durable request、response、deferred permission 和 blocked 事实生命周期均可自动验证。
- 全部自动化验证通过，会话、artifact 与 Acceptance 合同保持一致。
- 不存在可变交互旁路存储、callback 重绑、secret 落盘、普通问题直接 blocked 或 hook 原子副作用假设。
- CLI 输入、应用交互、领域状态、SDK callback 和 artifact 职责分离。
- 可创建独立 Git checkpoint，并为 workspace preservation 提供明确 suspension 意图。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除 durable interaction/deferred/response 契约及测试，不移除 Acceptance、session 或 artifact 基础。
