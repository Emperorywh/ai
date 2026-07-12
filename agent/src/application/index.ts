/**
 * Application 编排层入口。
 *
 * 职责：编排用例流程（规划、Context Pack 生成、调度、状态编排、合并）。
 * 硬约束：不直接 import infrastructure 实现类，
 * 一律经 src/application/ports.ts 中的窄接口（Port）依赖基础设施。
 */
// TASK-015：application → infrastructure 窄接口（Ports）与 Context Pack 生成器。
export * from './ports.js'
// TASK-036/037：执行 / 审查 Ports（TaskExecutorPort / TaskReviewerPort + 输入输出 + §18 启动提示）
// 与单任务执行用例（ExecuteTaskUseCase）。串行编排 SPEC §20.3：Executor/Reviewer 契约单一来源，
// SDK 实现经结构类型满足 Port；TASK-037 起执行用例复用这些 Port，CLI 降为 composition root。
export * from './execution/index.js'
export * from './context-pack-generator.js'
// TASK-016：拓扑排序与并行检测（调度计算）。
export * from './scheduler.js'
// TASK-017：状态流转编排器（读 frontmatter → 校验转移 → 写回 status）。
export * from './state-orchestrator.js'
// TASK-019：合并编排——rebase + 回填 execution_commits + fast-forward（§3.2）。
export * from './merge/rebase-ff.js'
// TASK-020：合并编排——全局文档 section 回写与冲突（§3.2 串行回写 + id 分配去重）。
export * from './merge/section-writeback.js'
// TASK-021：合并编排——幂等恢复（§3.2 合并崩溃后按 git 状态判定 skip/重合并 + 补回写）。
export * from './merge/recovery.js'
// TASK-029：规划工作流（SPEC/ARCHITECTURE → PLAN 草案 + 任务草案集合 + 任务图校验）。
export * from './planning-workflow.js'
