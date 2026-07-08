/**
 * Core 领域层入口。
 *
 * 职责：承载领域模型、Zod Schema、任务状态机与领域规则。
 * 硬约束：本层不依赖 application / infrastructure / cli 任何上层，
 * 也不依赖 SQLite / Git / MCP / Claude Agent SDK。
 *
 * 后续任务（TASK-002 起）在此导出领域原语、枚举、Schema、状态机与规则。
 */
// TASK-002：领域原语（枚举）。
export * from './enums.js'
// TASK-003：任务文件 frontmatter Schema。
export * from './schemas/task-schema.js'
// TASK-004：决策与问题机器字段 Schema。
export * from './schemas/decision-issue-schema.js'
// TASK-005：执行结果（.result.md）frontmatter Schema。
export * from './schemas/result-schema.js'
