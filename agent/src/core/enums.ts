/**
 * Core 领域原语：枚举与字面量联合类型。
 *
 * 本文件集中定义被后续 Schema（TASK-003…006）与领域规则（TASK-007…009）
 * 共享的全部领域枚举。每个枚举同时导出：
 *   - Zod schema（`XxxSchema`）：作为上层复合 Schema 的校验构件；
 *   - TS 联合类型（`Xxx`）：供业务代码用作类型标注，由 `z.infer` 派生，
 *     与 schema 同源，杜绝「类型标注」与「校验规则」两套取值漂移。
 * 需要遍历某枚举的全部合法值时，使用 `XxxSchema.options`
 * （zod ZodEnum 原生属性，返回声明值数组）。
 *
 * 权威来源：根目录 Readme.md。每条枚举的取值依据在各自注释中标注章节号。
 *
 * 硬约束（AGENTS.md §2 / docs/ARCHITECTURE.md §3）：本文件只依赖 zod，
 * 零反向依赖——不依赖 application / infrastructure / cli，
 * 也不依赖 SQLite / Git / MCP / Claude Agent SDK。
 */
import { z } from 'zod'

/* ============================================================ *
 * Layer —— 任务所属物理/逻辑分层（Readme.md §9 任务文件模板，7 值）
 * ============================================================ */

/**
 * Layer 枚举（7 值）。
 *
 * 用于 Context Pack 裁剪（§8）、Reviewer 分层审查（§15）与 SQLite 索引（§3.1）。
 * 与 PLAN 阶段是松散对应：一个阶段可横跨多 layer，一个 layer 也可出现在多阶段。
 *
 * 注意：`state` 取值在本项目当前计划中暂不被任何任务使用（状态机与状态编排
 * 归入 domain，见 docs/ARCHITECTURE.md §5），但枚举仍完整保留，
 * 供未来或其他项目启用。
 */
export const LayerSchema = z.enum([
  'type', // 类型层：Schema / 枚举 / 领域原语
  'data', // 数据层：fs / sqlite / git / sdk / mcp 适配
  'state', // 状态层：本项目当前计划未启用，枚举保留
  'domain', // 业务逻辑层：状态机 / 规则 / 用例编排
  'ui', // UI 组件层（当前计划不实现，后期 Tauri/React）
  'page', // 页面组合层：CLI 命令入口 / composition root
  'test', // 测试层
] as const)
export type Layer = z.infer<typeof LayerSchema>

/* ============================================================ *
 * Permission —— 任务权限能力（Readme.md §16 权限模型，9 项）
 * ============================================================ */

/**
 * Permission 枚举（9 项）。
 *
 * read_files / write_files 默认允许（项目文件读取 + allowed_paths / result_file 写入）；
 * 其余能力默认禁用，必须在任务 frontmatter `permissions` 中显式声明后生效。
 * 验证 allowlist 内命令的执行授权自动获得（仅限该具体命令行），
 * 无需在 permissions 中重复声明 run_commands（§16）。
 */
export const PermissionSchema = z.enum([
  'read_files', // 读取项目文件（默认允许）
  'write_files', // 写入 allowed_paths 与 result_file（默认允许）
  'run_commands', // 执行验证 allowlist 之外的任意命令（默认禁用）
  'install_dependencies', // 安装依赖（默认禁用）
  'modify_config', // 修改配置文件（默认禁用）
  'delete_files', // 删除文件（默认禁用）
  'start_dev_server', // 启动长期运行的开发服务（默认禁用）
  'open_browser', // 打开浏览器（默认禁用；禁止自动启动浏览器测试）
  'network_access', // 联网访问（默认禁用）
] as const)
export type Permission = z.infer<typeof PermissionSchema>

/* ============================================================ *
 * TaskStatus —— 任务状态机取值（Readme.md §7 任务状态机，9 态）
 * ============================================================ */

/**
 * TaskStatus 枚举（9 态）。
 *
 * 完整状态流转规则见 Readme.md §7。本枚举仅定义取值，流转合法性校验
 * 由 TASK-007 状态机与 TASK-008 状态映射承载，本文件不实现。
 */
export const TaskStatusSchema = z.enum([
  'draft', // 草稿，尚未准备执行
  'ready', // 已准备，可执行
  'running', // 正在执行
  'blocked', // 被阻塞，需人工确认或前置任务
  'reviewing', // 等待审查
  'done', // 常态终态：已完成并通过 Reviewer 审查或免审校验
  'rejected', // 执行结果被驳回，需返工
  'failed', // 执行失败且无法自动重试，等待人工介入/重开/取消
  'cancelled', // 任务被取消，不再执行（终态）
] as const)
export type TaskStatus = z.infer<typeof TaskStatusSchema>

/* ============================================================ *
 * ExecutionStatus —— .result.md 执行结论（Readme.md §10，3 值）
 * ============================================================ */

/**
 * ExecutionStatus 枚举（3 值）。
 *
 * 写入 .result.md frontmatter 的 `execution_status` 字段。
 * 与 next_action 的合法 / 非法组合由 TASK-008 状态映射承载（见 §10 映射表）。
 */
export const ExecutionStatusSchema = z.enum([
  'completed', // 任务执行完成，产物就绪
  'blocked', // 被阻塞，需人工确认 / 扩权 / 前置任务
  'failed', // 执行失败，无法自动重试
] as const)
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>

/* ============================================================ *
 * NextAction —— .result.md 建议下一步（Readme.md §10，4 值）
 * ============================================================ */

/**
 * NextAction 枚举（4 值）。
 *
 * 这是 Task Executor 的「建议」，最终状态流转由 Orchestrator 结合 Reviewer 结论
 * 与人工确认决定（§10）。retry 不等于自动重跑——failed 任务的 retry 仍需人工确认
 * 后才能回到 ready（§7）。
 */
export const NextActionSchema = z.enum([
  'review', // 进入 Reviewer 独立审查
  'retry', // 建议重试（仍需 Orchestrator / 人工确认后才回到 ready）
  'needs-human', // 需要人工确认 / 扩权
  'cancel', // 建议取消（需 Orchestrator / 人工确认）
] as const)
export type NextAction = z.infer<typeof NextActionSchema>

/* ============================================================ *
 * ReviewResult —— .review.md 审查结论（Readme.md §15，4 值）
 * ============================================================ */

/**
 * ReviewResult 枚举（4 值）。
 *
 * 审查结果到任务状态的映射固定（§15）：
 *   approved                 -> done
 *   rejected                 -> rejected
 *   needs-human-confirmation -> blocked
 *   skipped                  -> no_review: true 时由 Orchestrator 生成，Reviewer 不介入
 */
export const ReviewResultSchema = z.enum([
  'approved', // 审查通过
  'rejected', // 审查驳回，需返工
  'needs-human-confirmation', // 需人工确认
  'skipped', // no_review: true 时，Reviewer 不介入
] as const)
export type ReviewResult = z.infer<typeof ReviewResultSchema>

/* ============================================================ *
 * ProgressMode —— PROGRESS section 更新模式（Readme.md §10，2 值）
 * ============================================================ */

/**
 * ProgressMode 枚举（2 值）。
 *
 * 用于 .result.md 的 global_update_requests.progress 项，声明对目标 section 的
 * 合并方式（§10）。section 级机器判定合并规则见 §3.2。
 */
export const ProgressModeSchema = z.enum([
  'replace', // 整段替换 docs/PROGRESS.md 的目标 section
  'append', // 拼接到目标 section 末尾
] as const)
export type ProgressMode = z.infer<typeof ProgressModeSchema>

/* ============================================================ *
 * Scope —— 决策 / 问题的来源标识（Readme.md §6.6 / §6.7）
 * ============================================================ */

/**
 * Scope 阶段标识。
 *
 * SPEC / ARCHITECTURE 阶段产生的决策与问题不归属具体任务，
 * 其 created_from_task 填这两个阶段标识，与任务 id 一并为合法 scope 值
 * （Readme.md §6.6 / §6.7）。
 */
export const ScopeStageSchema = z.enum(['SPEC', 'ARCHITECTURE'] as const)
export type ScopeStage = z.infer<typeof ScopeStageSchema>

/**
 * 任务 id 校验正则：`TASK-` 后跟一位及以上数字。
 *
 * 任务 id 是开放式集合（任意 TASK-XXX），无法穷举为字面量联合，
 * 故单独以正则校验，再与阶段标识组合成完整 Scope。
 * 既接受项目惯用的三位编号（TASK-001），也接受其他位数（TASK-1 / TASK-100）。
 */
export const TASK_ID_PATTERN = /^TASK-\d+$/
export const TaskIdSchema = z.string().regex(
  TASK_ID_PATTERN,
  '任务 id 必须形如 TASK-\\d+（例如 TASK-003）',
)
/**
 * 任务 id 是开放式集合，类型上退化为 string（无法穷举字面量），
 * 运行时合法取值由 TaskIdSchema 校验。上层可借此类型做语义标注。
 */
export type TaskId = string

/**
 * Scope schema：阶段标识 ∪ 任务 id（异构联合）。
 *
 * 合法值 = `'SPEC'` | `'ARCHITECTURE'` | 任意匹配 `TASK-\d+` 的任务 id。
 * 上层复合 Schema（TASK-004 决策 / 问题 Schema）复用本 schema 校验
 * `created_from_task` 字段，无需重复实现 union。注意：决策 / 问题记录中独立的
 * `scope`（影响范围）字段是自由文本（见 docs/DECISIONS.md DEC-003），不使用本 schema。
 */
export const ScopeSchema = z.union([ScopeStageSchema, TaskIdSchema])
export type Scope = z.infer<typeof ScopeSchema>

/* ============================================================ *
 * DecisionStatus —— 架构决策状态（Readme.md §6.6 / §10）
 * ============================================================ */

/**
 * DecisionStatus 枚举（Readme.md §6.6 权威取值）。
 *
 *   - `proposed`：提议中，尚未由 Orchestrator 确认回写（Task Executor 提议时 id 留空）。
 *   - `accepted`：已确认接受（Orchestrator 回写确认后的稳态）。
 *   - `superseded`：被后续新决策取代——旧决策保留记录并标注，而非删除。
 */
export const DecisionStatusSchema = z.enum([
  'proposed', // 提议中，尚未由 Orchestrator 确认回写
  'accepted', // 已确认接受（Readme.md §10 示例）
  'superseded', // 被后续新决策取代
] as const)
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>

/* ============================================================ *
 * IssueStatus —— 问题状态（Readme.md §6.7 / §10）
 * ============================================================ */

/**
 * IssueStatus 枚举（Readme.md §6.7 权威取值）。
 *
 *   - `open`：未解决。
 *   - `resolved`：已解决。
 */
export const IssueStatusSchema = z.enum([
  'open', // 未解决（Readme.md §10 示例）
  'resolved', // 已解决
] as const)
export type IssueStatus = z.infer<typeof IssueStatusSchema>

/* ============================================================ *
 * IssueSeverity —— 问题严重程度（Readme.md §6.7 / §10 / §17）
 * ============================================================ */

/**
 * IssueSeverity 枚举（Readme.md §6.7 权威取值）。
 *
 *   - `low` / `medium` / `high` / `critical`：由轻到重 4 级分级；
 *     §17「按 severity 与停留时长的升级提醒」按级别触发升级。
 */
export const IssueSeveritySchema = z.enum([
  'low', // 低
  'medium', // 中
  'high', // 高（Readme.md §10 示例）
  'critical', // 严重
] as const)
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>
