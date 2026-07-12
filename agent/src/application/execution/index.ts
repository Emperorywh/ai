/**
 * Application 执行 / 审查 / 验证契约与执行 / 审查 / 完成 / 验证用例的模块入口（ARCHITECTURE.md §2 / §4）。
 *
 * 汇总 application/execution 下的导出：
 *   - ports.ts：TaskExecutorPort / TaskReviewerPort / VerificationRunnerPort 契约 + 输入输出 + §18 启动提示（TASK-036 / TASK-039）。
 *   - execute-task.ts：单任务执行 Application 用例 ExecuteTaskUseCase（TASK-037）。
 *   - review-task.ts：单任务审查 Application 用例 ReviewTaskUseCase（TASK-038）。
 *   - finalize-task.ts：单任务共享完成 Application 用例 FinalizeTaskUseCase（TASK-038）。
 *   - verify-task.ts：单任务系统验证 Application 用例 VerifyTaskUseCase（TASK-039）。
 *
 * 供 application/index.ts 统一 re-export，使 CLI / 后续串行 Orchestrator 经
 * `application/index.js` 一处取用执行 / 审查 / 完成 / 验证侧契约与用例。
 */
export * from './ports.js'
export * from './execute-task.js'
export * from './review-task.js'
export * from './finalize-task.js'
export * from './verify-task.js'
