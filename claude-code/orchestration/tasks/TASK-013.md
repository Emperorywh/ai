---
id: TASK-013
title: 建立完整 RunState v7 聚合与不变量
---

## 任务描述

### 可验证结果

RunState v7 能以一个 strict、带 revision、大小有界的完整聚合表达 TASK 和 Integration supervision、交互、pause、workspace、lease、commit、artifact roots 与 finalization；所有 status/phase 都能由持久事实唯一派生。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 5、8、15、16、17.2、19、20.1 和 21 阶段 0 第 1 项。
- TASK-001～012 已冻结的合同、artifact、candidate、session、verification、review、acceptance、interaction、workspace 和 commit 类型。
- 当前 RunState v6、TaskAttemptState、直接 transition 函数和 v6 legacy blocker 迁移。

### 输出

- SPEC 顶层固定字段的 RunState v7 strict schema、TaskRunState、IntegrationAcceptanceState 和共用 SupervisionState。
- Run/Task status、phase、resume stage、active scope、durable reservation 和 finalization 的派生规则。
- 连续 TASK 完成前缀、最多一个 active scope/request/attempt/lease/commit 和同候选证据不变量。
- 活跃对象、有界 recent refs、history manifest 和 2 MiB 序列化上限规则。
- state bytes 无法解析、可解析但不变量损坏和合法 failed 事实的不同处理契约。
- 完整状态转换表和纯领域测试；所有 SPEC 引用字段有唯一正式定义。

### 实现约束

- version 固定为 7；不读取、不迁移、不恢复 v6 或旧完成协议。
- status 按 terminal→pause→interaction→running 派生；持久投影与派生结果不一致即损坏。
- 所有可变交互状态仅在 RunState；正文与历史明细只通过 immutable artifact hash 引用。
- 全部 TASK completed 只进入 integration acceptance，不代表 Run completed。
- completed 必须有 commit、certificate、CompletionEvidenceBundle 和 final artifact manifest。
- 无法解析 state bytes 时只读保留原文件并失败退出，禁止覆盖成 failed。
- 超出大小必须先合法 history compaction，禁止截断 JSON 或丢活跃恢复事实。
- 阶段 0 可不切换当前 runtime，但不得形成第二套可发布 fallback。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：构造 TASK 与 Integration 完整主路径、反馈、人工、pause、commit recovery 和 finalization 状态，验证 status/phase 唯一派生。
3. 正常路径：验证连续 TASK 前缀、单 active scope、durable reservation 和有界 history compaction。
4. 异常路径：验证双 active 对象、非法 resumeStage、stale candidate evidence、completed 缺证据、status 双事实源、未知字段和 v6 状态均被拒绝。
5. 损坏路径：验证非法 JSON/Schema state bytes 原样保留；可解析不可恢复冲突才允许由合法事实进入 failed。

### 完成标准

- RunState v7 聚合、字段、状态派生和不变量完整，无 implementation TODO。
- 全部自动化验证通过，线性队列、Git 身份和证据绑定保持或增强。
- 不存在 v6 migration/fallback、旁路可变状态、无限历史或状态字段互相猜测。
- 聚合、纯不变量、artifact 引用与持久化解析职责清晰。
- 可创建独立 Git checkpoint，并为 revision effect/fact 归约模型提供唯一状态对象。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除尚未切换生产 runtime 的 v7 聚合和不变量证明，不回退 TASK-001～012，也不破坏当前 v6 可运行基线。
