---
id: TASK-015
title: 证明 SDK 多轮协议可安全恢复
---

## 任务描述

### 可验证结果

Fake SDK stream 能证明 streaming 多轮 Worker、deterministic control receipt、send ambiguity、idle/requires_action、background replace、interrupt receipt、deferred tool 和遗留 process lease 均可按 RunState v7 恢复。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 8.3～8.4、9.1～9.6、12、16、19.2、20.2 和 21 阶段 0 第 7 项。
- TASK-004 的 deterministic receipt artifact。
- TASK-006 的会话/process/outbox 契约。
- TASK-010 的 durable interaction/deferred 状态。
- TASK-014 的 revision mutation queue/reducer/quiescence/pause 语义。
- 锁定 SDK 公开类型中真实存在的 streaming/resume/interrupt/deferred/dialog/session event。

### 输出

- 不调用真实 Claude 的 Fake SDK stream conformance harness。
- init/model handshake、稳定 user UUID、stream input、resume epoch 和单 in-flight turn 证明。
- running/idle/requires_action、background replace、task lifecycle、result priority、compact boundary 和 quiescence 投影证明。
- deterministic AgentControl receipt、outbox ambiguity、transcript reconciliation 和 interrupt receipt 全集恢复证明。
- PreToolUse deferred 与 live callback 转 durable request 的边界证明。
- process lease 各崩溃窗口及遗留进程先停止后恢复证明，附 SDK 真实语义 ADR。

### 实现约束

- 不虚构 SDK exactly-once、callback 重连、后台查询或主动 compact API。
- UUID 只用于观察/对账；send_started 后不可见或矛盾必须 ambiguous/reconcile。
- result priority 固定为认证/模型→tool_deferred→background_requested→普通结果。
- requires_action 无损投影并阻止冻结；新 epoch level state 从空/unknown 开始。
- 普通 turn 完成要求 report+result+idle+空后台+quiescence；compact 不要求 control report。
- deferred allow 先 checkpoint decision_dispatching，再等 effect/denial observation。
- observer 失败不改变业务；关键 protocol fact 缺失 fail closed。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：Fake stream 执行 initial→continue→verification/review feedback 的同 session 多轮，并跨 epoch resume。
3. 正常路径：init/model、idle、空 background/task、receipt 和 result 收敛后才候选就绪。
4. 异常路径：覆盖 send ambiguity、still_queued known/unknown、capability missing、requires_action 未对账、deferred payload 缺失和 dispatch 崩溃，预期 paused/reconcile/protocol。
5. 恢复路径：覆盖 receipt 已写未 checkpoint、result 已到未归约、旧 lease 运行、后台未停止和 compact 中断，验证不重复 turn。

### 完成标准

- Fake SDK conformance 覆盖多轮、resume、permission、receipt、activity 和崩溃对账。
- 全部自动化验证通过，v7 revision/状态不变量在并发事件下成立。
- 不存在 UUID exactly-once、callback 重绑、backgroundTasks 查询误用、deferred 被普通成功吞掉或无 lease 新进程。
- SDK 适配、protocol projector、process ownership、state reducer 和 observer 边界明确。
- 可创建独立 Git checkpoint，并完成阶段 0 的 SDK 可实现性证明。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除 Fake SDK conformance 和 ADR，不回退 v7 领域/状态模型或当前 v6 executor。
