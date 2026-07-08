/**
 * Infrastructure 适配层入口。
 *
 * 职责：实现外部系统适配（fs 文档仓储 / sqlite 索引 / git worktree / sdk / mcp）。
 * 硬约束：只做适配，不承载业务规则；可依赖 core 的领域模型与 Schema，
 * 但不得反向被 application 直接 import（application 经 Port 接口依赖本层）。
 *
 * 后续任务（TASK-010 起）在此导出各仓储与适配器。
 */
export * from './fs/frontmatter-parser.js'
