/**
 * Application 编排层入口。
 *
 * 职责：编排用例流程（规划、Context Pack 生成、调度、状态编排、合并）。
 * 硬约束：不直接 import infrastructure 实现类，
 * 一律经 src/application/ports.ts 中的窄接口（Port）依赖基础设施。
 */
// TASK-015：application → infrastructure 窄接口（Ports）与 Context Pack 生成器。
export * from './ports.js'
export * from './context-pack-generator.js'
// TASK-016：拓扑排序与并行检测（调度计算）。
export * from './scheduler.js'
// TASK-017：状态流转编排器（读 frontmatter → 校验转移 → 写回 status）。
export * from './state-orchestrator.js'
// TASK-019：合并编排——rebase + 回填 execution_commits + fast-forward（§3.2）。
export * from './merge/rebase-ff.js'
