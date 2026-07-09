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
// TASK-011：任务 / 结果 / 审查文档仓储（读写即 Zod 校验）。
export * from './fs/task-doc-repo.js'
// TASK-012：全局文档（PROGRESS / DECISIONS / ISSUES）仓储与 section 合并。
export * from './fs/global-doc-repo.js'
// TASK-013：SQLite 索引表 DDL 与前向迁移（runMigrations，幂等）。
export * from './sqlite/schema.js'
// TASK-014：SQLite 索引仓储（upsert / query / rebuildFromDocs，写入容错不阻断）。
export * from './sqlite/index-repo.js'
// TASK-018：Git worktree 生命周期与合并原语适配器（子进程调系统 git）。
export * from './git/worktree-adapter.js'
// TASK-022：Task Executor 契约 + Claude Agent SDK 适配器（DryRun 兜底 + 注入式 SDK 骨架）。
export * from './sdk/executor-contract.js'
export * from './sdk/claude-sdk-adapter.js'
// TASK-028：MCP 适配器骨架（注册机制 + 统一调用代理，具体 server 留空抛「未配置」错误）。
export * from './mcp/mcp-adapter.js'
