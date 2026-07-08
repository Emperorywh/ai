/**
 * Core 执行结果 Schema（.result.md frontmatter，Readme.md §10）。
 *
 * 本文件是 `.result.md` frontmatter 的结构校验入口：Task Executor 执行完毕后把
 * 执行事实写入 frontmatter（§10），Orchestrator 读取后映射任务状态（TASK-008）、
 * 合并时回填 execution_commits（TASK-019）、按 section 回写全局文档（TASK-020）。
 *
 * 设计约束：
 *   - 仅依赖 zod 与 src/core/enums.ts / decision-issue-schema.ts，零反向依赖（AGENTS.md §2）。
 *   - 复用 enums.ts 的 ExecutionStatusSchema / NextActionSchema / ProgressModeSchema /
 *     TaskIdSchema，复用 decision-issue-schema.ts 的 DecisionSchema / IssueSchema，
 *     不重复声明枚举取值或决策 / 问题字段集（TASK-002 / TASK-004 单一来源决策）。
 *   - Zod schema 为单一来源，TS 类型由 z.infer 派生，杜绝类型与校验漂移。
 *
 * 边界（任务 §7 / §12）：
 *   - 不实现 execution_status × next_action → status 映射（TASK-008）；本 Schema 只校验
 *     单字段枚举取值，非法组合（completed+retry / blocked+review / failed+review）
 *     由 TASK-008 在运行期判定，不在此硬拒，避免重复约束。
 *   - 不实现 .result.md 读写（TASK-011）。
 *
 * 字段语义要点：
 *   - execution_commits 默认 []（§10），由 Orchestrator 在 rebase 后、fast-forward 前
 *     回填 post-rebase 的执行 commit 元信息（§3.2）；Executor 提议时留空。
 *   - verification[].result ∈ passed / failed / skipped（§10），该三值枚举当前仅在
 *     .result.md 的 verification 上下文使用，enums.ts 暂未定义，故就近定义于本文件。
 *   - global_update_requests.decisions / issues 复用 DecisionSchema / IssueSchema，
 *     提议态 id 留空，由 Orchestrator 回写分配 DEC-XXX / ISS-XXX。
 */
import { z } from 'zod'
import {
  ExecutionStatusSchema,
  NextActionSchema,
  ProgressModeSchema,
  TaskIdSchema,
} from '../enums.js'
import { DecisionSchema, IssueSchema } from './decision-issue-schema.js'

/* ============================================================ *
 * verification 条目（Readme.md §10）
 * ============================================================ */

/**
 * 验证结果枚举（Readme.md §10 verification.result，3 值）。
 *
 *   - passed：验证命令通过。
 *   - failed：验证命令失败。
 *   - skipped：验证命令被跳过（如 layer 不适用）。
 *
 * 该枚举仅服务于 .result.md 的 verification 上下文，enums.ts 暂未定义，
 * 故就近定义于本文件；若后续被其他层复用，可提升至 enums.ts（届时由对应任务处理）。
 */
export const VerificationResultSchema = z.enum([
  'passed', // 验证命令通过
  'failed', // 验证命令失败
  'skipped', // 验证命令被跳过
] as const)
export type VerificationResult = z.infer<typeof VerificationResultSchema>

/**
 * verification 单条记录 schema。
 *
 * §10 最小结构：{ command, result, notes }。command 为执行的验证命令行（非空）；
 * result 复用 VerificationResultSchema；notes 为人工补充说明，允许空串。
 */
export const ResultVerificationSchema = z.object({
  command: z.string().min(1, 'verification[].command 必填且非空'),
  result: VerificationResultSchema,
  notes: z.string(),
})
export type ResultVerification = z.infer<typeof ResultVerificationSchema>

/* ============================================================ *
 * execution_commits 条目（Readme.md §10 / §3.2）
 * ============================================================ */

/**
 * 执行 commit 元信息 schema（Readme.md §3.2 / §10）。
 *
 * Orchestrator 在 rebase 完成、fast-forward 合并之前，采集 post-rebase 的执行 commit
 * 元信息并回填到 execution_commits：hash（主分支历史中实际存在的 commit hash）、
 * message、author、time（ISO 时间戳）。四元组由 git 提供，结构锁定于此；
 * rebase 前的旧 hash 一律丢弃，不作为审计依据（§3.2）。
 *
 * Executor 提议时 execution_commits 留空（默认 []），元素何时出现由 Orchestrator 决定。
 */
export const ExecutionCommitSchema = z.object({
  hash: z.string(),
  message: z.string(),
  author: z.string(),
  time: z.string(),
})
export type ExecutionCommit = z.infer<typeof ExecutionCommitSchema>

/* ============================================================ *
 * global_update_requests 子项（Readme.md §10 / §3.2）
 * ============================================================ */

/**
 * PROGRESS section 更新请求 schema（Readme.md §10 / §3.2）。
 *
 * §10 最小结构：{ section, mode, content }。section 对应 docs/PROGRESS.md 的目标
 * 章节（非空）；mode 复用 enums.ts 的 ProgressModeSchema（replace 整段替换 /
 * append 拼接到末尾），section 级合并规则见 §3.2；content 为待写入内容（非空）。
 */
export const ProgressUpdateRequestSchema = z.object({
  section: z.string().min(1, 'progress[].section 必填且非空'),
  mode: ProgressModeSchema,
  content: z.string().min(1, 'progress[].content 必填且非空'),
})
export type ProgressUpdateRequest = z.infer<typeof ProgressUpdateRequestSchema>

/**
 * global_update_requests schema（Readme.md §10）。
 *
 * 三子项均为数组且必填（§10 模板显式出现），允许空数组（Executor 无对应更新时填 []）：
 *   - progress：ProgressUpdateRequestSchema[]，section 级合并（§3.2）。
 *   - decisions：DecisionSchema[]，复用 TASK-004 字段集，提议态 id 留空。
 *   - issues：IssueSchema[]，复用 TASK-004 字段集，提议态 id 留空。
 */
export const GlobalUpdateRequestsSchema = z.object({
  progress: z.array(ProgressUpdateRequestSchema),
  decisions: z.array(DecisionSchema),
  issues: z.array(IssueSchema),
})
export type GlobalUpdateRequests = z.infer<typeof GlobalUpdateRequestsSchema>

/* ============================================================ *
 * .result.md frontmatter（Readme.md §10）
 * ============================================================ */

/**
 * 执行结果 frontmatter schema（Readme.md §10）。
 *
 * 覆盖 §10 模板全部机器字段：
 *   - task_id：复用 enums.ts 的 TaskIdSchema（TASK-\d+）。
 *   - execution_status：复用 ExecutionStatusSchema（completed / blocked / failed）。
 *   - modified_files / created_files / deleted_files：文件路径数组，允许空。
 *   - execution_commits：默认 []，由 Orchestrator 回填（§3.2）。
 *   - verification：ResultVerificationSchema[]，允许空。
 *   - global_update_requests：三子项结构见上，均允许空数组。
 *   - next_action：复用 NextActionSchema（review / retry / needs-human / cancel）。
 *
 * 注意（任务 §12 风险点）：execution_status × next_action 的非法组合
 * （completed+retry / blocked+review / failed+review）不在 Schema 层硬拒，
 * 只校验单字段枚举；组合合法性由 TASK-008 状态映射在运行期判定。
 */
export const ResultFrontmatterSchema = z.object({
  task_id: TaskIdSchema,
  execution_status: ExecutionStatusSchema,
  modified_files: z.array(z.string()),
  created_files: z.array(z.string()),
  deleted_files: z.array(z.string()),
  execution_commits: z.array(ExecutionCommitSchema).default([]),
  verification: z.array(ResultVerificationSchema),
  global_update_requests: GlobalUpdateRequestsSchema,
  next_action: NextActionSchema,
})
export type ResultFrontmatter = z.infer<typeof ResultFrontmatterSchema>
