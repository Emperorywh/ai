/**
 * Claude Agent SDK 适配器（infrastructure/sdk/claude-sdk-adapter.ts）。
 *
 * 本文件实现 TaskExecutorPort（application/execution/ports.ts，TASK-036 收敛）的两个具体执行器：
 *   - DryRunLocalExecutor：SDK 未就位时的兜底，**本地不调用模型**，产出占位 `.result.md`
 *     供前置阶段（状态流转 / 合并 / 全局文档回写）联调（任务 §2 / §7）。
 *   - ClaudeSdkExecutor：SDK 就位后经**注入式句柄** ClaudeSdkInvocation 调用模型；
 *     SDK 未注入（未安装 / API 未确认）时 execute 抛 ExecutorNotConfiguredError，
 *     **绝不伪造 SDK 调用**（任务 §7 / §12 R1）。
 *
 * 分层定位（ARCHITECTURE.md §4 / 任务 §1 / §8）：本文件是 infrastructure adapter，
 * **import application/execution/ports.ts 的执行契约类型**（ExecuteInput / ExecuteOutcome /
 * ExecutorPermissionBoundary / ExecutorError / TaskExecutorPort）作为方法签名——这是依赖倒置：
 * adapter 依赖 application 的 port 抽象（infrastructure → application，仅限 ports），不构成
 * application → infrastructure 的反向依赖。SDK 适配属 cli composition root 职责，core 仍零反向依赖。
 * 其余依赖：infrastructure → core（type-only + ResultFrontmatterSchema 运行时校验）、
 * infrastructure → infrastructure/fs（复用 serializeDocument 序列化 .result.md）。
 *
 * SDK 接入策略（任务 §12 R1「SDK API 未确认」是本计划最高风险）：
 *   - 不引入 npm 依赖（红线：package.json 不得新增），故不 import 具体 Claude Agent SDK。
 *   - 以注入式句柄 ClaudeSdkInvocation 隔离 SDK：编排层（本文件）负责把 Context Pack +
 *     §18 启动提示 + 权限边界组装为 SDK 调用入参、把 SDK 返回的报告落成合法 `.result.md`；
 *     句柄负责「调用模型 + 解析输出为 SdkRunReport」（依赖 SDK 真实 API，待 SDK 就位实现）。
 *   - 未决项（SDK 版本 / 子 agent 派发 / Context Pack 注入方式 / 权限与 hooks 注入点）
 *     落 ISSUES 与 DECISIONS，不在本文件伪造。
 *
 * 权威来源：根目录 Readme.md §5.2（Task Executor）/ §10（.result.md 模板）/
 * §16（权限模型）/ §18（启动提示）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { serializeDocument } from '../fs/frontmatter-parser.js'
import {
  ResultFrontmatterSchema,
  type ContextPack,
  type ExecutionStatus,
  type GlobalUpdateRequests,
  type NextAction,
  type ResultFrontmatter,
  type ResultVerification,
} from '../../core/index.js'
import {
  ExecutorError,
  type ExecuteInput,
  type ExecuteOutcome,
  type ExecutorPermissionBoundary,
  type TaskExecutorPort,
} from '../../application/execution/ports.js'

/* ============================================================ *
 * 共享：.result.md 落盘（校验 + 序列化 + 写文件）
 * ============================================================ */

/**
 * 把 ResultFrontmatter + 正文落盘为 .result.md（任务 §11 验收「过 ResultFrontmatterSchema」）。
 *
 * 先用 ResultFrontmatterSchema 做 safeParse 校验（执行器产出的 frontmatter 必须合法，
 * 校验失败抛 ExecutorError 不静默），再经 serializeDocument 序列化为 `---\n<yaml>\n---\n<body>`
 * 并写入 result_file（父目录自动创建，适配 worktree 内新建路径）。
 *
 * 两执行器共用，避免重复实现「校验 + 序列化 + 写盘」管线。
 */
function persistResult(
  resultFile: string,
  frontmatter: ResultFrontmatter,
  body: string,
): void {
  const parsed = ResultFrontmatterSchema.safeParse(frontmatter)
  if (!parsed.success) {
    throw new ExecutorError(
      `.result.md frontmatter 未通过 ResultFrontmatterSchema 校验：${parsed.error.message}`,
    )
  }
  const content = serializeDocument(parsed.data, body)
  mkdirSync(dirname(resultFile), { recursive: true })
  writeFileSync(resultFile, content, 'utf8')
}

/* ============================================================ *
 * DryRunLocalExecutor —— SDK 未就位兜底（不调用模型）
 * ============================================================ */

/**
 * SDK 未就位时的本地兜底执行器（任务 §2 / §7）。
 *
 * 不调用模型、不实际执行验证命令：产出占位 `.result.md`——execution_status=completed、
 * 验证 allowlist 命令全标 skipped、global_update_requests 三项皆空、next_action=review
 * （completed+review 为合法组合，TASK-008 状态映射），供 cli / application 前置阶段
 * （状态流转 / 合并 / 全局文档回写）在无模型环境下联调。
 *
 * 该执行器产出的 .result.md 经 persistResult 过 ResultFrontmatterSchema，可被
 * TaskDocRepository.readResult 正常读取、被 Orchestrator 正常消费。
 */
export class DryRunLocalExecutor implements TaskExecutorPort {
  readonly name = 'dry-run-local'

  async execute(input: ExecuteInput): Promise<ExecuteOutcome> {
    // 验证 allowlist 命令占位为 skipped——dry-run 不实际执行验证命令（任务 §7「不伪造」）。
    const verification: ResultVerification[] =
      input.permission_boundary.verification_commands.map((cmd) => ({
        command: cmd.command,
        result: 'skipped',
        notes: 'dry-run 占位，未实际执行验证命令',
      }))

    const frontmatter: ResultFrontmatter = {
      task_id: input.task_id,
      execution_status: 'completed',
      modified_files: [],
      created_files: [],
      deleted_files: [],
      // execution_commits 由 Orchestrator 在 rebase 后 / fast-forward 前回填（§3.2），Executor 留空。
      execution_commits: [],
      verification,
      global_update_requests: { progress: [], decisions: [], issues: [] },
      next_action: 'review',
    }

    persistResult(input.result_file, frontmatter, dryRunBody(input.task_id))
    return { result_file: input.result_file, execution_status: 'completed' }
  }
}

/** DryRun 占位 .result.md 正文（§10 模板精简，标注占位来源）。 */
function dryRunBody(taskId: string): string {
  return [
    `# ${taskId} 执行结果`,
    '',
    '> 本结果由 DryRunLocalExecutor 占位产出（未调用模型），',
    '> 供前置阶段（状态流转 / 合并 / 全局文档回写）联调使用。',
    '',
    '## 1. 执行结论',
    '',
    'dry-run 占位完成：未实际执行任务，仅产出过 ResultFrontmatterSchema 校验的占位 `.result.md`。',
    '',
    '## 10. 验证结果',
    '',
    '验证 allowlist 中的命令在 dry-run 下均标记为 skipped（未实际执行）。',
    '',
  ].join('\n')
}

/* ============================================================ *
 * ClaudeSdkInvocation —— 注入式 SDK 调用句柄（接口隔离）
 * ============================================================ */

/**
 * ClaudeSdkInvocation 的调用入参（编排层 → 句柄）。
 *
 * 把契约的 ExecuteInput 投影为「SDK 调用所需的最小集合」：工作目录、§18 启动提示、
 * Context Pack 注入清单、权限边界。句柄实现据此调用具体 SDK（注入 prompt / 文件 / 权限）。
 */
export interface SdkRunInput {
  /** Executor 工作目录（worktree 根）。 */
  readonly worktreePath: string
  /** §18 启动提示（buildStartupPrompt 产出）。 */
  readonly startupPrompt: string
  /** Context Pack 注入清单（§8）。 */
  readonly contextPack: ContextPack
  /** 已解析的权限边界（§16）。 */
  readonly permissionBoundary: ExecutorPermissionBoundary
}

/**
 * SDK 执行后返回的报告（句柄 → 编排层）。
 *
 * 句柄负责「调用模型 + 把模型输出解析为可落 .result.md 的结构化报告」。编排层
 * （ClaudeSdkExecutor）据此组装 ResultFrontmatter，不猜测 SDK 具体 API。字段对齐
 * §10 frontmatter 的机器字段：executionStatus / 三类文件清单 / verification /
 * globalUpdateRequests / nextAction，execution_commits 仍由 Orchestrator 回填（留空）。
 *
 * 注意：本接口的精确形态（如何把模型输出映射为这些字段）依赖 SDK 真实 API，待 SDK
 * 就位时确认（见 ISSUES / DECISIONS）；当前作为接口隔离的合理抽象存在。
 */
export interface SdkRunReport {
  /** 执行结论（completed / blocked / failed）。 */
  readonly executionStatus: ExecutionStatus
  /** 模型改动的文件清单（写入 .result.md modified_files）。 */
  readonly modifiedFiles: readonly string[]
  /** 模型新建的文件清单（写入 .result.md created_files）。 */
  readonly createdFiles: readonly string[]
  /** 模型删除的文件清单（写入 .result.md deleted_files）。 */
  readonly deletedFiles: readonly string[]
  /** 验证命令执行结果（command / result / notes，写入 .result.md verification）。 */
  readonly verification: readonly ResultVerification[]
  /** 全局文档更新建议（写入 .result.md global_update_requests）。 */
  readonly globalUpdateRequests: GlobalUpdateRequests
  /** 建议下一步（review / retry / needs-human / cancel，写入 .result.md next_action）。 */
  readonly nextAction: NextAction
  /** 可选的人工可读摘要（写入 .result.md 正文「执行结论」）。 */
  readonly summary?: string
}

/**
 * 注入式 Claude Agent SDK 调用句柄（接口隔离，任务 §1 / §8）。
 *
 * 把「依赖具体 SDK API 的调用 + 输出解析」隔离于此接口的实现，ClaudeSdkExecutor 只
 * 经此抽象消费 SDK，core/application 不感知具体 SDK 类型。SDK 就位时由 cli composition
 * root 提供实现并注入 ClaudeSdkExecutor；SDK 未就位时注入 null，execute 抛
 * ExecutorNotConfiguredError（不伪造调用）。
 */
export interface ClaudeSdkInvocation {
  /** 句柄名称（供日志区分不同 SDK 实现）。 */
  readonly name: string
  /** 在指定工作目录调用模型执行任务，返回可落 .result.md 的报告。 */
  run(input: SdkRunInput): Promise<SdkRunReport>
}

/* ============================================================ *
 * ClaudeSdkExecutor —— 注入式 SDK 编排骨架
 * ============================================================ */

/**
 * Claude Agent SDK 未注入错误（任务 §7「不得伪造 SDK 调用」）。
 *
 * ClaudeSdkExecutor 构造时未注入 invocation（SDK 未安装 / API 未确认）即抛此错，
 * 明确提示需安装 SDK 并提供 invocation、或改用 DryRunLocalExecutor，不静默、不伪造。
 */
export class ExecutorNotConfiguredError extends ExecutorError {
  constructor(executorName: string) {
    super(
      `Executor "${executorName}" 未注入 Claude Agent SDK 调用句柄（ClaudeSdkInvocation 为 null）：` +
        'SDK 未安装 / API 未确认，无法调用模型。请先安装 @anthropic-ai/claude-agent-sdk ' +
        '并提供 invocation，或改用 DryRunLocalExecutor 联调。',
    )
    this.name = 'ExecutorNotConfiguredError'
  }
}

/**
 * Claude Agent SDK 执行器（注入式编排骨架）。
 *
 * 构造接收 ClaudeSdkInvocation | null：
 *   - invocation 为 null：execute 抛 ExecutorNotConfiguredError（SDK 未就位，不伪造）。
 *   - invocation 非 null：调用 invocation.run 组装入参 → 取 SdkRunReport → 组装
 *     ResultFrontmatter（execution_commits 留空待 Orchestrator 回填）→ persistResult
 *     落盘（过 Schema）→ 返回 ExecuteOutcome。
 *
 * 编排逻辑（入参组装 / 报告落盘）与 SDK 具体 API 解耦——SDK 真实 API 的映射封装在
 * invocation 实现内，待 SDK 就位时实现。当前无真实 invocation 实现（见 ISSUES），
 * 测试以 fake invocation 验证编排逻辑。
 */
export class ClaudeSdkExecutor implements TaskExecutorPort {
  readonly name = 'claude-sdk'
  private readonly invocation: ClaudeSdkInvocation | null

  constructor(invocation: ClaudeSdkInvocation | null) {
    this.invocation = invocation
  }

  async execute(input: ExecuteInput): Promise<ExecuteOutcome> {
    if (this.invocation === null) {
      throw new ExecutorNotConfiguredError(this.name)
    }
    const report = await this.invocation.run({
      worktreePath: input.worktree_path,
      startupPrompt: input.startup_prompt,
      contextPack: input.context_pack,
      permissionBoundary: input.permission_boundary,
    })

    const frontmatter: ResultFrontmatter = {
      task_id: input.task_id,
      execution_status: report.executionStatus,
      modified_files: [...report.modifiedFiles],
      created_files: [...report.createdFiles],
      deleted_files: [...report.deletedFiles],
      // execution_commits 由 Orchestrator 在合并前回填（§3.2），Executor 始终留空。
      execution_commits: [],
      verification: [...report.verification],
      global_update_requests: report.globalUpdateRequests,
      next_action: report.nextAction,
    }

    persistResult(input.result_file, frontmatter, sdkBody(input.task_id, report.summary))
    return { result_file: input.result_file, execution_status: report.executionStatus }
  }
}

/** ClaudeSdkExecutor 产出的 .result.md 正文（§10 模板精简 + 报告摘要）。 */
function sdkBody(taskId: string, summary?: string): string {
  return [
    `# ${taskId} 执行结果`,
    '',
    '> 本结果由 ClaudeSdkExecutor 经注入的 ClaudeSdkInvocation 调用模型后产出。',
    '',
    '## 1. 执行结论',
    '',
    summary ?? '（详见 frontmatter 字段）',
    '',
  ].join('\n')
}
