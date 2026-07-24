---
id: TASK-014
title: 建立 revision 驱动的唯一状态变更协议
---

## 任务描述

### 可验证结果

Policy、EffectCommand、DomainFact、单写者 mutation queue、唯一 reducer 与 checkpoint 能组成唯一状态流；并发旧 revision、重复/晚到事实和非法 causation 无法覆盖较新 RunState。

### 输入

- `SupervisedExecutionLoopSpec.md` 第 5.2、6、9、19、20.1、21 阶段 0 第 1 项。
- TASK-013 的完整 RunState v7 聚合和状态转换表。
- TASK-006/007/010/011/012 的进程、验证、交互、workspace 和 commit 长副作用身份。
- 当前 Stage/Coordinator 直接调用 transition 并决定下一阶段的现状。

### 输出

- scope-neutral pure Policy：只根据当前状态计划下一项 effect。
- EffectCommand 注册、稳定 commandId、expected revision 和 persisted active effect。
- DomainFact、observed revision、causation/subscription identity 与 late fact 分类。
- 单写者 mutation queue 和唯一 reducer，支持 current、already-included、monotonic-late、stale/conflict。
- Dispatcher 只读取已 checkpoint active effect、small handler 只执行一个 effect 并返回 fact 的应用契约。
- revision 竞争、effect 重入、晚到 fact、scope-neutral Task/Integration 路径的自动化测试与 ADR。

### 实现约束

- 只有 reducer 能产生新 RunState；Policy、Dispatcher、handler、SDK/Git/artifact adapter 均不得直接转换状态。
- command 必须先注册并 checkpoint，禁止执行 Policy 的内存返回值。
- 每次合法 register/reduce 恰好 revision +1；过期 command 必须重新计划。
- handler 重入先查匹配 immutable result fact；长副作用按 start/collect/interrupt 或 phase command 拆分。
- 晚到事实不能清空较新集合、回退 lifecycle、替换 candidate 或覆盖 operator/commit 状态。
- 冲突事实保存审计 artifact 后拒绝或转 reconcile，禁止 last-write-wins。
- Task/Integration adapter 只提供 scope 输入，不复制监督流程。

### 验证方式

1. 运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
2. 正常路径：以 effect/fact 驱动完整 TASK 和 Integration 主路径，验证每个副作用前后 checkpoint/revision 顺序。
3. 并发路径：两个 command 使用相同 expected revision 时只一个注册，另一个重计划；两个同 revision fact 不丢更新。
4. 晚到路径：分别验证重复、可单调归约、陈旧和冲突事实，不覆盖较新 lifecycle/candidate/interaction/commit。
5. 边界路径：验证 Dispatcher/handler 无法直接构造下一阶段，未持久 active effect 不能执行，稳定 commandId 重入幂等。

### 完成标准

- 唯一状态流、revision 并发模型和 effect/fact 转换表完整可执行。
- 全部自动化验证通过，RunState v7 不变量始终由 reducer/checkpoint 保证。
- 不存在 Stage/Coordinator 直写、内存 effect 执行、last-write-wins、巨型 workflow 或 Task/Integration 重复逻辑。
- 纯领域计划/归约、应用串行化/分派、外部 handler 和持久化职责清晰。
- 可创建独立 Git checkpoint，并满足阶段 0 的状态聚合与并发模型证明。

### 回退边界

回退本 TASK 的 Git checkpoint 只移除 revision Policy/Effect/Fact/Queue/Reducer 证明，不移除 RunState v7 聚合或前置领域契约。
