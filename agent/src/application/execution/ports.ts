/**
 * Application 执行 / 审查 Ports（ARCHITECTURE.md §4，串行编排 SPEC §20.3）。
 *
 * 本文件是 TaskExecutor 与 TaskReviewer 契约的**单一来源**（TASK-036 收敛）：
 *   - 把原本散落在 infrastructure（executor-contract.ts）与 CLI（task-review.ts）的
 *     执行 / 审查契约统一到 application，使串行 Orchestrator（application 层）能直接
 *     复用这些类型，不必反向依赖 infrastructure 或把业务循环堆在 CLI。
 *   - Execute / Review 的输入输出、权限边界、§18 启动提示类型各有唯一来源，禁止
 *     在 infrastructure / CLI 再复制结构类型维持"碰巧兼容"（任务 §8）。
 *
 * 依赖方向（任务 §8）：`cli → application ← infrastructure`。
 *   - application 在此定义 Port 抽象 + 共享类型；串行用例（TASK-037/038 及后续）经此
 *     依赖执行 / 审查能力，不感知具体 SDK 实现。
 *   - infrastructure 的 Claude SDK 适配器（claude-sdk-adapter.ts / claude-sdk-reviewer.ts）
 *     **import 本文件的共享类型**作为方法签名，并经 TypeScript 结构类型满足 Port——
 *     这是依赖倒置：adapter 依赖 application 的 port 抽象（infrastructure → application，
 *     仅限 ports），不构成 application → infrastructure 的反向依赖。
 *   - CLI composition root（task:run / task:review）实例化 SDK 实现，仅以 Port 类型交给用例。
 *
 * 设计约束（ARCHITECTURE.md §4 / 任务 §8）：
 *   - 本文件只导入 core 的类型（type-only）与 core 的 Schema 派生类型，零运行时反向依赖。
 *   - Port 接口不出现 Claude Agent SDK 专属类型（SDK API 隔离在 infra adapter 内）。
 *   - 借助 TypeScript 结构类型兼容，infra 实现类（DryRunLocalExecutor / ClaudeSdkExecutor /
 *     ClaudeSdkReviewer）与 CLI 兜底类（LocalReviewer）无需显式 `implements`，由 CLI wiring
 *     与 `implements` 子句共同在编译期证明结构满足 Port（任务 §11 验收）。
 *
 * 权威来源：根目录 Readme.md §5.2（Task Executor）/ §5.3（Reviewer）/ §15（审查清单与映射）/
 * §16（权限模型）/ §18（新上下文启动提示模板）。
 */
import type {
  ContextPack,
  ExecutionStatus,
  Permission,
  ResultFrontmatter,
  ReviewResult,
  TaskId,
  VerificationCommand,
  VerificationResult,
} from '../../core/index.js'

/* ============================================================ *
 * 执行侧：权限边界 + 输入输出 + Port
 * ============================================================ */

/**
 * Executor 执行期的权限边界（Readme.md §16）。
 *
 * 由 cli（task:run）/ 串行 Orchestrator 在启动 Executor 前用 TASK-009 的解析结果组装后注入：
 *   - allowed_paths / forbidden_paths：任务声明的路径作用域。启动前应已用
 *     `resolvePathScope`（permission-rules.ts）检测重叠并拒绝（deny 优先），到达
 *     Executor 时二者应已无重叠；Executor 据此约束模型读写范围。
 *   - permissions：任务 frontmatter 声明的能力（默认项之外的能力需显式声明）。
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

/**
 * Executor 单次执行输入（任务 §9 数据流：Context Pack + 权限 → Executor → .result.md）。
 *
 * 全部字段由 cli / Orchestrator 在 worktree 创建后、启动 Executor 前组装：
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

/**
 * Task Executor Port（Readme.md §5.2，串行编排 SPEC §20.3）。
 *
 * 把「调用模型 / 执行引擎 + 产出 .result.md」抽象为单一 execute 方法，具体实现：
 *   - DryRunLocalExecutor（claude-sdk-adapter.ts）：SDK 未就位兜底，本地不调用模型，
 *     产出占位 .result.md 供前置阶段（状态流转 / 合并 / 回写）联调。
 *   - ClaudeSdkExecutor（claude-sdk-adapter.ts）：SDK 就位后经注入式句柄调用模型。
 *
 * execute 为异步（SDK 模型调用为异步；DryRun 同步完成但统一返回 Promise 以兼容契约）。
 * 实现须保证：返回时 .result.md 已落盘且 frontmatter 过 ResultFrontmatterSchema；
 * 不可恢复的错误以 ExecutorError 抛出（不静默）。
 *
 * 命名为 Port（对齐 TaskDocRepositoryPort 等既有 port 命名，SPEC §20.3），
 * 取代旧 infrastructure 的 `TaskExecutor` 接口（已删除，不保留转发兼容层）。
 */
export interface TaskExecutorPort {
  /** 执行器名称（dry-run-local / claude-sdk，供日志区分）。 */
  readonly name: string
  /** 执行单个任务，产出 .result.md。 */
  execute(input: ExecuteInput): Promise<ExecuteOutcome>
}

/* ============================================================ *
 * 审查侧：输入输出 + Port
 * ============================================================ */

/**
 * Reviewer 审查输入：被审查任务的执行结果 + worktree 位置（供真实 reviewer agent 读取改动）。
 *
 * 复用执行侧的「注入式句柄」模式：编排层组装输入、消费审查结论，具体「调用模型 + 读改动 +
 * 产出结论」隔离于 Reviewer 实现内（SDK 就位后注入真实实现）。
 */
export interface ReviewInput {
  /** 当前任务 id。 */
  readonly task_id: TaskId
  /** 被审查的 .result.md frontmatter（execution_status / verification / 改动清单）。 */
  readonly result: ResultFrontmatter
  /** worktree 根目录（任务改动所在，供真实 reviewer agent 读取）。 */
  readonly worktree_path: string
  /** .result.md 相对仓库路径。 */
  readonly result_file: string
}

/**
 * Reviewer 审查输出：审查结论（不含 task_id / reviewer / reviewed_at，由命令层补全为 ReviewFrontmatter）。
 *
 * review_result 取 approved / rejected / needs-human-confirmation（§15）；skipped 专用于
 * no_review 的 Orchestrator 占位审查，不由 Reviewer 产出，故在此排除。
 */
export interface ReviewOutcome {
  /** 审查结论（approved / rejected / needs-human-confirmation）。 */
  readonly review_result: Exclude<ReviewResult, 'skipped'>
  /** 必须修改项（rejected / needs-human-confirmation 时填写，§15）。 */
  readonly required_changes: readonly string[]
  /** 审查发现清单。 */
  readonly findings: readonly string[]
}

/**
 * Task Reviewer Port（Readme.md §15 / §12，串行编排 SPEC §20.3）。
 *
 * 把「审查任务 + 产出审查结论」抽象为单一 review 方法，具体实现：
 *   - LocalReviewer（cli/commands/task-review.ts）：SDK 未就位兜底，本地确定性产出
 *     approved 供合并链路联调（§12）。
 *   - ClaudeSdkReviewer（claude-sdk-reviewer.ts）：SDK 就位后由上层注入（独立审查会话）。
 *
 * review 为异步（真实模型调用为异步；LocalReviewer 同步完成但统一返回 Promise 以兼容契约）。
 *
 * 命名为 Port（对齐既有 port 命名，SPEC §20.3），取代旧 CLI 的 `Reviewer` 接口
 * （已迁移到本文件，CLI 不再重复定义）。
 */
export interface TaskReviewerPort {
  /** 审查者名称（local-reviewer / 注入的 agent 名，供日志区分）。 */
  readonly name: string
  /** 审查单个任务，返回审查结论。 */
  review(input: ReviewInput): Promise<ReviewOutcome>
}

/* ============================================================ *
 * 系统验证侧：VerificationRunnerPort（TASK-039 / SPEC §20.3 / FR-011）
 * ============================================================ */

/**
 * VerificationRunner 单次执行输入（FR-011.4「在 worktree 内独立执行」）。
 *
 *   - command：要执行的验证命令行（allowlist 中的命令身份，原样透传）。
 *   - worktreePath：执行工作目录（任务 worktree 根），runner 在此目录内执行命令、采集真实退出码。
 */
export interface VerificationRunnerInput {
  /** 要执行的验证命令行。 */
  readonly command: string
  /** runner 执行命令的工作目录（任务 worktree 根）。 */
  readonly worktreePath: string
}

/**
 * VerificationRunner 单次执行输出（FR-011.4「记录真实退出码、stdout/stderr 摘要和耗时」）。
 *
 *   - command：回传命令行（与 input 一致，供调用方按命令归并）。
 *   - result：passed（退出码 0）/ failed（退出码非 0 或超时）/ skipped（命令声明明确不适用，FR-012）。
 *   - exitCode：真实退出码；null 表示无退出码（超时强制终止 / skipped 未执行）。
 *   - durationMs：真实耗时毫秒（>= 0）。
 *   - outputSummary：stdout / stderr 摘要（超时时写明「超时」），供审计与门禁原因输出。
 *
 * 不含 source 字段：记录经 VerifyTaskUseCase 映射为 ResultVerification 时统一标注 source='system'。
 */
export interface VerificationRunnerResult {
  /** 执行的命令行（与 input.command 一致）。 */
  readonly command: string
  /** 执行结果（passed / failed / skipped）。 */
  readonly result: VerificationResult
  /** 真实退出码；null 表示无退出码（超时 / skipped）。 */
  readonly exitCode: number | null
  /** 真实耗时毫秒。 */
  readonly durationMs: number
  /** stdout / stderr 摘要。 */
  readonly outputSummary: string
}

/**
 * Verification Runner Port（SPEC §20.3，FR-011 系统验证执行抽象）。
 *
 * 把「在 worktree 内真实执行单条验证命令 + 采集真实退出码 / 耗时 / 输出摘要」抽象为单一 run 方法。
 * Application（VerifyTaskUseCase）只经此 Port 依赖外部执行能力，**不感知子进程 / Node child_process /
 * shell 细节**——真实实现（TASK-040）落在 infrastructure，测试以 fake Runner 注入覆盖
 * passed / failed / skipped / 退出码 / 超时（任务 §11 验收）。
 *
 * run 为异步（命令执行为异步）。实现须保证：返回时已采集到真实退出码与输出摘要；超时强制终止后
 * 映射为 result='failed' + exitCode=null + outputSummary 注明超时（不静默吞错、不伪造 passed）。
 *
 * 本任务（TASK-039）只定义契约，不提供真实子进程实现（§7「不实现子进程命令执行」）——真实 Runner
 * 由 TASK-040 在 infrastructure 落地，此处仅是 application 依赖的窄接口。
 */
export interface VerificationRunnerPort {
  /** runner 名称（供日志区分不同实现，如 fake-runner / shell-runner）。 */
  readonly name: string
  /** 在指定 worktree 内执行单条验证命令，返回真实退出码 / 耗时 / 输出摘要。 */
  run(input: VerificationRunnerInput): Promise<VerificationRunnerResult>
}

/* ============================================================ *
 * §18 启动提示构建器（Readme.md §18，Executor 初始指令唯一文本来源）
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
 * 具体子类（如 ExecutorNotConfiguredError）定义在 claude-sdk-adapter.ts（infrastructure），
 * 经 `extends ExecutorError` 复用本基类——故本基类随执行契约留在 application 单一来源。
 */
export class ExecutorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutorError'
  }
}
