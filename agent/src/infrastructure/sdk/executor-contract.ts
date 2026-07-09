/**
 * Task Executor 契约（infrastructure/sdk/executor-contract.ts）。
 *
 * 本文件定义「执行引擎适配层」与调用方（cli task:run / task:review）之间的稳定契约：
 * Executor 接收 Context Pack（§8）+ 权限边界（§16，TASK-009 解析结果）+ §18 启动提示，
 * 在 worktree 内执行单个任务，产出合法的 `.result.md`（过 ResultFrontmatterSchema）。
 *
 * 分层定位（ARCHITECTURE.md §4）：本契约**仅被 cli 依赖、不经 application**——
 * application 层不感知具体执行引擎，故不构成 core/application 对 SDK 的反向依赖。
 * core/application 也不得 import 本文件的具体 SDK 类型（任务 §1 / §7）：对 SDK 的
 * 依赖以注入式句柄 `ClaudeSdkInvocation`（见 claude-sdk-adapter.ts）隔离，本文件只
 * 暴露与 SDK 无关的契约接口 `TaskExecutor` / 输入输出 / 权限边界 / §18 启动提示构建器。
 *
 * 设计约束（任务 §1 / §7 / §8）：
 *   - 仅 type-only import core 的领域类型（ContextPack / ExecutionStatus / Permission /
 *     TaskId / VerificationCommand），零反向依赖（不依赖 application/cli；不 import
 *     具体 Claude Agent SDK 类型——SDK API 未确认，见 ISSUES 与 DECISIONS）。
 *   - 不承载工作流领域逻辑（§3.1：执行引擎适配层不承载核心逻辑）：状态映射在 core
 *     （TASK-008），状态编排 / 合并 / 全局文档回写在 application（TASK-017/019/020/021），
 *     本契约只描述「执行边界」与「产出形态」。
 *   - §18 启动提示以纯函数 buildStartupPrompt 组装，占位符（TASK-XXX-xxx）由调用方
 *     传入实际值替换；模板文本唯一来源为 Readme.md §18，不在他处复制。
 *
 * 权威来源：根目录 Readme.md §5.2（Task Executor）/ §8（Context Pack）/
 * §16（权限模型）/ §18（新上下文启动提示模板）。
 */
import type {
  ContextPack,
  ExecutionStatus,
  Permission,
  TaskId,
  VerificationCommand,
} from '../../core/index.js'

/* ============================================================ *
 * 权限边界（§16，TASK-009 解析结果）
 * ============================================================ */

/**
 * Executor 执行期的权限边界（Readme.md §16）。
 *
 * 由 cli（task:run）在启动 Executor 前用 TASK-009 的解析结果组装后注入：
 *   - allowed_paths / forbidden_paths：任务声明的路径作用域。cli 启动前应已用
 *     `resolvePathScope`（permission-rules.ts）检测重叠并拒绝启动（deny 优先），
 *     到达 Executor 时二者应已无重叠；Executor 据此约束模型读写范围。
 *   - permissions：任务 frontmatter 声明的能力（默认项除外的能力需显式声明）。
 *   - verification_commands：经 `computeVerificationAllowlist`（verification-rules.ts）
 *     按 layer 裁剪 + 任务级并集后的验证 allowlist；其执行授权自动获得（§16），
 *     Executor 可据此运行验证命令并记录结果。
 *
 * 本结构是「已解析、可执行」的边界快照，Executor 不再二次解析 frontmatter。
 */
export interface ExecutorPermissionBoundary {
  /** 允许写入的路径作用域（任务 allowed_paths，已与 forbidden 无重叠）。 */
  readonly allowed_paths: readonly string[]
  /** 禁止写入的路径作用域（任务 forbidden_paths，deny 优先已生效）。 */
  readonly forbidden_paths: readonly string[]
  /** 任务 frontmatter 声明的能力（默认项 read_files/write_files 之外的能力）。 */
  readonly permissions: readonly Permission[]
  /** 验证 allowlist（layer 裁剪 + 任务级并集，每条含 requires_permissions）。 */
  readonly verification_commands: readonly VerificationCommand[]
}

/* ============================================================ *
 * 执行输入 / 输出
 * ============================================================ */

/**
 * Executor 单次执行输入（任务 §9 数据流：Context Pack + 权限 → Executor → .result.md）。
 *
 * 全部字段由 cli 在 worktree 创建后、启动 Executor 前组装：
 *   - worktree_path：Executor 的工作目录（§3.2 每个 running 任务独立 worktree）；
 *     DryRun / SDK 两实现均在此目录下执行 / 写入。
 *   - result_file：任务唯一允许写入的结果文件绝对路径（workflow_outputs.result_file，
 *     §3.2 默认允许写入、不计入 allowed_paths）；Executor 把执行事实写入其 frontmatter。
 *   - context_pack：computeContextPack（TASK-015）产出的最终注入清单，Executor 据此
 *     约束读取范围（§8：实际注入范围 ⊆ 清单，不得自行扩展）。
 *   - permission_boundary：见 ExecutorPermissionBoundary。
 *   - startup_prompt：buildStartupPrompt 产出的 §18 启动提示，作为 Executor 初始指令。
 */
export interface ExecuteInput {
  /** 当前任务 id（与 result_file 的 task_id 一致）。 */
  readonly task_id: TaskId
  /** Executor 工作目录（worktree 根）。 */
  readonly worktree_path: string
  /** 输出 .result.md 的绝对路径。 */
  readonly result_file: string
  /** 最终 Context Pack 注入清单（required_docs / optional_doc_excerpts / source_files）。 */
  readonly context_pack: ContextPack
  /** 已解析的权限边界（§16）。 */
  readonly permission_boundary: ExecutorPermissionBoundary
  /** §18 启动提示（buildStartupPrompt 产出）。 */
  readonly startup_prompt: string
}

/**
 * Executor 单次执行输出。
 *
 * Executor 执行完毕（含失败 / 阻塞）后返回：.result.md 已落盘（过 ResultFrontmatterSchema），
 * execution_status 为 completed / blocked / failed 之一。后续状态流转（reviewing / done /
 * blocked 等）由 Orchestrator 经 TASK-008 状态映射 + TASK-017 编排决定，不在 Executor 职责内。
 */
export interface ExecuteOutcome {
  /** 已写入的 .result.md 路径（与 input.result_file 一致）。 */
  readonly result_file: string
  /** 执行结论（completed / blocked / failed）。 */
  readonly execution_status: ExecutionStatus
}

/* ============================================================ *
 * 契约接口
 * ============================================================ */

/**
 * Task Executor 契约接口（Readme.md §5.2）。
 *
 * 把「调用模型 / 执行引擎 + 产出 .result.md」抽象为单一 execute 方法，具体实现：
 *   - DryRunLocalExecutor（claude-sdk-adapter.ts）：SDK 未就位兜底，本地不调用模型，
 *     产出占位 .result.md 供前置阶段（状态流转 / 合并 / 回写）联调。
 *   - ClaudeSdkExecutor（claude-sdk-adapter.ts）：SDK 就位后经注入式句柄调用模型。
 *
 * execute 为异步（SDK 模型调用为异步；DryRun 同步完成但统一返回 Promise 以兼容契约）。
 * 实现须保证：返回时 .result.md 已落盘且 frontmatter 过 ResultFrontmatterSchema；
 * 不可恢复的错误以 ExecutorError 抛出（不静默）。
 */
export interface TaskExecutor {
  /** 执行器名称（dry-run-local / claude-sdk，供日志区分）。 */
  readonly name: string
  /** 执行单个任务，产出 .result.md。 */
  execute(input: ExecuteInput): Promise<ExecuteOutcome>
}

/* ============================================================ *
 * §18 启动提示构建器（Readme.md §18）
 * ============================================================ */

/**
 * buildStartupPrompt 的输入：占位符替换所需的实际值。
 */
export interface StartupPromptArgs {
  /** 当前任务 id（如 TASK-022）。 */
  readonly taskId: TaskId
  /** 当前任务文件路径（如 docs/tasks/TASK-022-xxx.md）。 */
  readonly taskFile: string
  /** 结果文件路径（如 docs/tasks/TASK-022-xxx.result.md）。 */
  readonly resultFile: string
}

/**
 * 组装 §18 新上下文启动提示（Readme.md §18 唯一文本来源）。
 *
 * 把模板中的 `docs/tasks/TASK-XXX-xxx.md` / `docs/tasks/TASK-XXX-xxx.result.md`
 * 占位符替换为传入的实际任务文件 / 结果文件路径，其余文本原样保留（不在他处复制模板，
 * 避免日后改一处漏一处）。该提示作为 Executor 的初始指令注入（DryRun 不消费其内容，
 * SDK 实现把它作为系统 / 初始 prompt）。
 */
export function buildStartupPrompt(args: StartupPromptArgs): string {
  return STARTUP_PROMPT_TEMPLATE.replace(
    /docs\/tasks\/TASK-XXX-xxx\.result\.md/g,
    args.resultFile,
  ).replace(/docs\/tasks\/TASK-XXX-xxx\.md/g, args.taskFile)
}

/**
 * §18 启动提示模板（Readme.md §18 原文）。
 *
 * 仅含两处占位：`docs/tasks/TASK-XXX-xxx.md`（必读核心第 4 项 + 执行规则）与
 * `docs/tasks/TASK-XXX-xxx.result.md`（完成 / 阻塞 / 失败后必须生成）。buildStartupPrompt
 * 先替换 result.md 占位（长串优先），再替换 .md 占位，避免误伤。
 */
const STARTUP_PROMPT_TEMPLATE = `你现在是本项目的 Task Executor。

请严格读取并遵循当前任务 Context Pack 清单中的文件。以下文件为默认必读核心：

1. AGENTS.md
2. docs/ARCHITECTURE.md
3. docs/PROGRESS.md
4. docs/tasks/TASK-XXX-xxx.md

如 Context Pack 清单中包含 docs/SPEC.md、docs/PLAN.md、docs/DECISIONS.md、docs/ISSUES.md、docs/TESTING.md 的相关章节或源码文件，也必须一并读取；未出现在清单中的文件不得自行扩展读取或修改。

执行规则：

- 本次上下文只执行 docs/tasks/TASK-XXX-xxx.md。
- 不执行后续任务。
- 不依赖历史聊天记录。
- 先复述你对当前任务的理解。
- 明确当前任务属于哪一层。
- 明确会修改哪些模块。
- 明确不会修改哪些模块。
- 明确必须遵守哪些架构边界。
- 如发现文档冲突、需求不清或架构问题，先指出问题，不要直接编码。
- 修改代码时遵守 AGENTS.md 中的全部约束（AGENTS.md 是编码约束唯一权威，此处不重复）。
- 完成、阻塞或失败后必须生成 docs/tasks/TASK-XXX-xxx.result.md；审查结论由 Reviewer / Orchestrator 写入 .review.md，不要写入 .result.md。
- 需要更新 docs/PROGRESS.md、docs/DECISIONS.md 或 docs/ISSUES.md 时，只能在 .result.md 的 global_update_requests 中提出建议，由 Orchestrator 回写。`

/* ============================================================ *
 * 错误类型
 * ============================================================ */

/**
 * Executor 错误基类。
 *
 * 不可恢复的执行失败（SDK 未注入、文件写入失败、产物非法等）以此抛出，不静默。
 * 具体子类（如 ExecutorNotConfiguredError）定义在 claude-sdk-adapter.ts。
 */
export class ExecutorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutorError'
  }
}
