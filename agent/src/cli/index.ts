/**
 * CLI 交互层入口。
 *
 * 职责：作为命令入口与 composition root，把 infrastructure 实现注入 application 用例。
 * 硬约束：不拥有核心状态机与任务规则，只编排 application / infrastructure。
 *
 * 后续任务（TASK-023 起）在此注册
 * init / plan / task:create / task:run / task:review / status / rebuild-index 命令。
 */
export {}
