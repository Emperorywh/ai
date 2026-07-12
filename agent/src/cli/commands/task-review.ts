import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Command } from 'commander'
import {
  ReviewTaskUseCase,
  FinalizeTaskUseCase,
  type IdAllocator,
} from '../../application/index.js'
import type {
  GitMergePort,
  GlobalDocRepositoryPort,
} from '../../application/ports.js'
// TASK-036：审查契约（TaskReviewerPort + ReviewOutcome）自 application execution/ports
// 导入（单一来源）；本文件不再重复定义，仅保留 LocalReviewer 兜底实现。
import type {
  ReviewOutcome,
  TaskReviewerPort,
} from '../../application/execution/ports.js'
import type {
  ReviewResult,
  TaskId,
  TaskStatus,
} from '../../core/index.js'
import { ClaudeSdkReviewer, GitMergeAdapter, TaskDocRepository } from '../../infrastructure/index.js'
// 复用 TASK-026/034/038 已导出的 cli 公共助手——全局文档 fs 适配器 + 顺序 id 分配器 +
// §7 可观测性上下文（createObservability，TASK-034）+ cost 摘要类型 + 主工作区结果文件同步
// （syncMainWorktreeFile，TASK-038 起 FinalizeTaskUseCase 的 syncMainFile 注入回调），避免重复实现（AGENTS §3）。
// task-run.ts 虽曾属其他任务 forbidden_paths，但 forbidden 约束的是「修改」而非「依赖」——
// 本文件自 TASK-027 起即跨命令 import task-run.ts 导出助手（先例），此处仅扩展该 import。
import {
  createFsGlobalDocRepo,
  createObservability,
  sequentialIdAllocator,
  syncMainWorktreeFile,
  type CostSummary,
  type Observability,
} from './task-run.js'
// Provider Profile 配置读取 + SDK env 组装（TASK-031，forbidden 只 import 不改源码）。
import {
  DEFAULT_CONFIG_PATH,
  composeProviderEnv,
  readProfileConfig,
} from '../config/provider-profile.js'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * `task:review` 命令：Reviewer 审查编排集成入口（Readme.md §5.3 / §15 / §3.2）。
 *
 * 职责（TASK-038 起）：「审查阶段」（读 .result.md → 产出 .review.md → applyReview 状态映射）
 * 委托 ReviewTaskUseCase（application/execution/review-task.ts）；done 路径「合并回收」委托
 * 共享 FinalizeTaskUseCase（application/execution/finalize-task.ts，task:run / task:review /
 * Orchestrator 共用，SPEC §20.4）。本文件只负责：
 *   - composition root 装配：infrastructure 实现（TaskDocRepository / LocalReviewer /
 *     ClaudeSdkReviewer / GitMergeAdapter / GlobalDocRepository）wiring 注入 ReviewTaskPorts /
 *     FinalizeTaskPorts；provider/observability 组装（assembleReviewer）。
 *   - 串联用例：review → (done) → finalize；rejected/blocked 保留 worktree 不合并。
 *   - commander 注册。
 *
 * 审查结论到状态的映射固定（§15）：approved→done、rejected→rejected、
 * needs-human-confirmation→blocked；skipped 表示 no_review 任务 Reviewer 不介入，
 * 由 Orchestrator 校验 .result.md 产物齐全后决定 done（齐全）或 blocked（不齐全）。
 *
 * 合并触发规则（§8 / §9 数据流）：只有 approved→done 才合并;reviewing / rejected /
 * blocked 一律不合并且保留 worktree（§8「禁止把 reviewing 或 rejected 的任务回收到主分支」）。
 * 新鲜合并走 rebaseAndFastForward(019) + writebackGlobalDocs(020);recoverMerge(021)
 * 留作崩溃续跑入口（DEC-022），本命令单次成功路径不调用。
 *
 * 分层定位（ARCHITECTURE.md §4 / 任务 §8）：CLI 是 composition root——只编排 application +
 * infrastructure，不持有状态机、不重复领域规则。审查编排自 TASK-038 起收敛到 ReviewTaskUseCase，
 * 合并回收收敛到 FinalizeTaskUseCase（本文件不再持有可复用的审查 / 合并 / 冲突登记逻辑）。
 *
 * 权威来源：根目录 Readme.md §5.3（Reviewer）/ §15（审查清单与映射）/ §3.2（合并策略）。
 */

/** 默认主分支短名（§3.2）。 */
const DEFAULT_MAIN_REF = 'main'
/** 默认 worktree 根目录（相对项目根）。 */
const DEFAULT_WORKTREES_REL = '.worktrees'

/* ============================================================ *
 * LocalReviewer —— SDK 未就位兜底实现（审查契约见 application/execution/ports.ts）
 * ============================================================ */

/**
 * 本地审查器（SDK 未就位兜底，§12「若未就位用本地审查器兜底，避免阻塞」）。
 *
 * 不调用模型、不读改动，确定性产出 approved（与 TASK-022 DryRunLocalExecutor 产 completed 同义：
 * 让 done + 合并链路在无模型环境可联调）。真实审查由上层注入 TaskReviewerPort 实现（如
 * ClaudeSdkReviewer）；当前以本地兜底交付，不伪造模型调用。
 *
 * TASK-036：审查契约（TaskReviewerPort / ReviewInput / ReviewOutcome）已收敛到
 * application/execution/ports.ts，本类 `implements TaskReviewerPort` 在编译期证明结构满足 Port。
 */
export class LocalReviewer implements TaskReviewerPort {
  readonly name = 'local-reviewer'
  async review(): Promise<ReviewOutcome> {
    return { review_result: 'approved', required_changes: [], findings: [] }
  }
}

/* ============================================================ *
 * 结果与选项类型
 * ============================================================ */

/** `task:review` 的执行结果（供命令层输出 / 测试断言）。 */
export interface TaskReviewOutcome {
  readonly taskId: TaskId
  /** 审查 + 状态流转后的最终任务状态（done / rejected / blocked）。 */
  readonly finalStatus: TaskStatus
  /** 审查结论（approved / rejected / needs-human-confirmation / skipped）。 */
  readonly reviewResult: ReviewResult
  /** 审查者标识（注入的 reviewer 名 / orchestrator）。 */
  readonly reviewer: string
  /** worktree 绝对路径（rejected / blocked 时保留供人工处理）。 */
  readonly worktreePath: string
  /** 是否触发了合并回收（仅 done 路径成功合并时为 true）。 */
  readonly merged: boolean
  /** 合并冲突文件清单（仅合并冲突时非空）。 */
  readonly conflicts: readonly string[]
  /** §7 cost 摘要（SDK 路径非空；LocalReviewer 无 SDK 会话为 undefined）。 */
  readonly cost?: CostSummary
}

/**
 * reviewTask 的可注入依赖。
 *
 * 默认全部接真实适配器（LocalReviewer / 真实 GitMergeAdapter / 文件系统全局文档仓储 /
 * 顺序 id 分配器）；测试可注入 fake reviewer（控制 approved/rejected/needs-human）与
 * fake gitMergePort（模拟合并冲突），复用 TASK-026 测试隔离模式。
 */
export interface TaskReviewOptions {
  /** 项目根目录（默认当前工作目录）。 */
  readonly projectRoot?: string
  /** 主分支短名（默认 main）。 */
  readonly mainRef?: string
  /** worktree 根目录（默认 <项目根>/.worktrees）。 */
  readonly worktreesDir?: string
  /** Reviewer（默认 LocalReviewer；SDK 就位后由上层注入真实 agent）。 */
  readonly reviewer?: TaskReviewerPort
  /** 合并用 git 原语 Port（默认真实 GitMergeAdapter；测试可注入 fake 模拟冲突）。 */
  readonly gitMergePort?: GitMergePort
  /** 全局文档读写 Port（默认文件系统适配器；测试可注入内存版）。 */
  readonly globalDocRepo?: GlobalDocRepositoryPort
  /** DEC-XXX / ISS-XXX id 分配器（默认顺序分配）。 */
  readonly idAllocator?: IdAllocator
}

/* ============================================================ *
 * 公开 API：reviewTask
 * ============================================================ */

/**
 * 审查单个任务（Readme.md §5.3 / §15 / §3.2）—— composition root 入口。
 *
 * TASK-038 起，「审查阶段」（读 .result.md → 产出审查结论 → 写 .review.md → applyReview
 * 状态映射）委托 ReviewTaskUseCase；done 路径「合并回收」委托共享 FinalizeTaskUseCase
 * （task:run / task:review / Orchestrator 共用，SPEC §20.4）。本函数只负责装配 Ports
 * （审查用例 + 完成用例）+ worktree 定位。
 *
 * 状态权威在 main 仓库 frontmatter（TaskDocRepository 读写 reviewing→done/rejected/blocked）；
 * 执行产物 .result.md 在 worktree（task:run 写、合并经 rebase+ff 回收进 main）。
 */
export async function reviewTask(
  taskId: TaskId,
  options: TaskReviewOptions = {},
): Promise<TaskReviewOutcome> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd())
  const mainRef = options.mainRef ?? DEFAULT_MAIN_REF
  const worktreesDir = resolve(options.worktreesDir ?? join(projectRoot, DEFAULT_WORKTREES_REL))
  const reviewer = options.reviewer ?? new LocalReviewer()
  const globalRepo = options.globalDocRepo ?? createFsGlobalDocRepo(projectRoot)
  const idAllocator = options.idAllocator ?? sequentialIdAllocator()

  const tasksDir = join(projectRoot, 'docs', 'tasks')
  if (!existsSync(tasksDir)) {
    throw new Error(`任务目录不存在: ${tasksDir}（请先在项目根运行 caw init）`)
  }

  // worktree 定位（task:run 创建并保留至审查;产物 .result.md 在 worktree，尚未合并入 main）。
  const wtPath = resolve(worktreesDir, taskId)
  if (!existsSync(wtPath)) {
    throw new Error(
      `任务 ${taskId} 的 worktree 不存在: ${wtPath}（审查需 caw task:run 产出的 worktree）`,
    )
  }

  // main 仓库文档仓储：任务状态权威 + .review.md 落点。
  const mainRepo = new TaskDocRepository(tasksDir)

  // 审查阶段（领域编排全部在用例内）→ 结构化结果（finalStatus / reviewResult / task / result）。
  const reviewUseCase = new ReviewTaskUseCase({
    taskRepo: mainRepo,
    reviewer,
    openWorktreeRepo: (p) => new TaskDocRepository(join(p, 'docs', 'tasks')),
  })
  const reviewed = await reviewUseCase.review({ taskId, worktreePath: wtPath })

  // 合并阶段（done 路径）—— 委托共享 FinalizeTaskUseCase（TASK-038 / SPEC §20.4）。
  // rejected/blocked 保留 worktree 不合并（§8「禁止 reviewing/rejected 回收」）。
  let merged = false
  let conflicts: string[] = []
  if (reviewed.finalStatus === 'done') {
    const finalizeUseCase = new FinalizeTaskUseCase({
      taskRepo: mainRepo,
      gitMerge: options.gitMergePort ?? new GitMergeAdapter(projectRoot, worktreesDir),
      globalDocRepo: globalRepo,
      idAllocator,
      openWorktreeRepo: (p) => new TaskDocRepository(join(p, 'docs', 'tasks')),
      syncMainFile: (resultFileRel) => syncMainWorktreeFile(projectRoot, mainRef, resultFileRel),
    })
    const finalizeOutcome = finalizeUseCase.finalize({
      taskId,
      mainRef,
      worktreePath: reviewed.worktreePath,
      task: reviewed.task,
      result: reviewed.result,
    })
    merged = finalizeOutcome.merged
    conflicts = [...finalizeOutcome.conflicts]
  }

  const finalStatus = mainRepo.readTask(taskId).status
  return {
    taskId,
    finalStatus,
    reviewResult: reviewed.reviewResult,
    reviewer: reviewed.reviewer,
    worktreePath: wtPath,
    merged,
    conflicts,
  }
}

/* ============================================================ *
 * composition root：profile → env → reviewer（SPEC §6 / §13.2 / 任务 §2）
 * ============================================================ */

/**
 * reviewer 构造工厂类型（默认真实 ClaudeSdkReviewer；测试注入 fake 验装配 + outcome）。
 *
 * 与 task-run.ts 的 InvocationFactory 同构（providerEnv/model/onMessage/stderr/abortController），
 * 区别在产物是 Reviewer（审查器）而非 invocation（执行器句柄）——两 SDK 会话类（执行 / 审查）
 * 构造字段集对齐（TASK-033 ClaudeSdkReviewerOptions 字段集与 ClaudeSdkInvocationImpl 对齐）。
 */
export type ReviewerFactory = (opts: {
  readonly providerEnv: Readonly<Record<string, string>>
  readonly model?: string
  readonly onMessage?: (message: SDKMessage) => void
  readonly stderr?: (data: string) => void
  readonly abortController: AbortController
}) => TaskReviewerPort

/** assembleReviewer 输入（composition root 装配参数）。 */
export interface AssembleReviewerInput {
  readonly projectRoot: string
  readonly taskId: TaskId
  /** --provider 覆盖启用的 profile 名。 */
  readonly provider?: string
  /** --model 覆盖具体模型名（直接写入 reviewer.model，SPEC §6「覆盖具体模型」）。 */
  readonly model?: string
  /** --reviewer：'local' 显式回退；'sdk' 显式 SDK；省略 = auto（token 就位走 SDK，否则回退 LocalReviewer）。 */
  readonly reviewerKind?: 'local' | 'sdk'
  /** 配置文件路径（默认 <projectRoot>/.caw/config.json）。 */
  readonly configPath?: string
  /** 环境来源（默认 process.env；测试注入隔离真实环境）。 */
  readonly env?: NodeJS.ProcessEnv
  /** reviewer 构造工厂（默认真实 ClaudeSdkReviewer；测试注入 fake）。 */
  readonly reviewerFactory?: ReviewerFactory
  /** 透传 createObservability 的开关（测试关闭终端渲染 / SIGINT wiring）。 */
  readonly stream?: boolean
  readonly wireSigInt?: boolean
}

/** assembleReviewer 结果：reviewer + 可观测性上下文（cost 采集自后者，§7）。 */
export interface AssembledReviewer {
  readonly reviewer: TaskReviewerPort
  readonly observability: Observability
}

/**
 * composition root（SPEC §6 / §13.2 / 任务 §2）：读 profile → 组装 env → 构造 reviewer。
 *
 * 装配策略（任务 §2「LocalReviewer 保留兜底」+ §12「SDK 未就位用本地审查器兜底」，与 task:run 不同——
 * review 有 LocalReviewer 合法兜底）：
 *  - `--reviewer local`：不读 token，直接 LocalReviewer（仍建可观测性，无 SDK 会话则 cost=undefined）；
 *  - `--reviewer sdk`：readProfileConfig → composeProviderEnv（token 缺失由 buildProviderEnv 抛
 *    ProviderTokenMissingError → 不静默，显式 SDK 不回退，对称 task:run --executor sdk）→ ClaudeSdkReviewer；
 *  - 省略 = auto：尝试读 profile + 组装 env；成功 → ClaudeSdkReviewer；失败（配置缺失 / token 缺失 /
 *    profile 不存在）→ 回退 LocalReviewer + 显著告警（§12 兜底 + ISS-016 不静默放行）。
 *
 * 与 task:run（assembleExecutor）的关键差异：task:run 的 auto + token 缺失 = 报错（执行必须用 SDK，
 * DryRun 只是显式选项，SPEC §14.3）；task:review 的 auto + key 缺失 = 回退 LocalReviewer（审查有
 * 合法兜底，§12）。该差异使 `caw task:review <id>`（无 --reviewer）在无 provider 配置时仍可跑通
 * （LocalReviewer 确定性 approved → done + 合并），不因配置缺失而阻断既有工作流。
 *
 * `--model` 作为具体模型名直接写入 reviewer.model（SPEC §6「覆盖具体模型，写入 options.model」），
 * 省略则 reviewer.model 为 undefined → SDK 经 ANTHROPIC_DEFAULT_*_MODEL env 按档位自选。
 * 可观测回调（onMessage/stderr/abortController）注入 reviewer，sdk-client 透传 SDKMessage 流。
 */
export function assembleReviewer(input: AssembleReviewerInput): AssembledReviewer {
  if (
    input.reviewerKind !== undefined &&
    input.reviewerKind !== 'local' &&
    input.reviewerKind !== 'sdk'
  ) {
    throw new Error(`--reviewer 只支持 local | sdk（收到「${input.reviewerKind}」）`)
  }

  const observability = createObservability({
    projectRoot: input.projectRoot,
    taskId: input.taskId,
    stream: input.stream,
    wireSigInt: input.wireSigInt,
  })

  // 显式 local → 不读 token，直接回退（§12 兜底）。
  if (input.reviewerKind === 'local') {
    return { reviewer: new LocalReviewer(), observability }
  }

  // sdk / auto：读 profile + 组装 env。
  const configPath = input.configPath ?? join(input.projectRoot, DEFAULT_CONFIG_PATH)
  try {
    const config = readProfileConfig(configPath)
    const providerEnv = composeProviderEnv(config, {
      providerOverride: input.provider,
      env: input.env,
    })
    const factory = input.reviewerFactory ?? defaultReviewerFactory
    const reviewer = factory({
      providerEnv,
      model: input.model,
      onMessage: observability.onMessage,
      stderr: observability.stderr,
      abortController: observability.abortController,
    })
    return { reviewer, observability }
  } catch (e) {
    // 显式 sdk 不回退：用户明确要求 SDK，配置/token 缺失是错误（对称 task:run --executor sdk）。
    if (input.reviewerKind === 'sdk') throw e
    // auto：回退 LocalReviewer + 显著告警（§12 兜底 + ISS-016 不静默放行）。
    const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    console.warn(
      `warning: SDK reviewer 装配失败（${reason}），回退 LocalReviewer 兜底——` +
        'LocalReviewer 确定性产 approved，不经真实审查（如需真实审查请配置 provider profile token）。',
    )
    return { reviewer: new LocalReviewer(), observability }
  }
}

/**
 * 默认 reviewer 工厂：构造真实 ClaudeSdkReviewer（注入 provider env + 可观测回调 + abortController）。
 *
 * ClaudeSdkReviewer（TASK-033）`implements TaskReviewerPort`（TASK-036 收敛后审查契约在 application
 * execution/ports），其 review(input: ReviewInput): Promise<ReviewOutcome> 与 Port 逐一一致——
 * 此处 `new ClaudeSdkReviewer(...)` 直接赋给 TaskReviewerPort（兼容性经 implements + wiring typecheck 双重验证）。
 */
const defaultReviewerFactory: ReviewerFactory = (opts) =>
  new ClaudeSdkReviewer({
    providerEnv: { ...opts.providerEnv },
    model: opts.model,
    onMessage: opts.onMessage,
    stderr: opts.stderr,
    abortController: opts.abortController,
  })

/** reviewTaskWithAssembly 选项（CLI action 传参，组合装配 + 编排注入）。 */
export interface ReviewTaskWithAssemblyOptions {
  readonly projectRoot?: string
  readonly mainRef?: string
  readonly worktreesDir?: string
  readonly provider?: string
  readonly model?: string
  readonly reviewer?: 'local' | 'sdk'
  readonly configPath?: string
  readonly env?: NodeJS.ProcessEnv
  readonly reviewerFactory?: ReviewerFactory
  readonly stream?: boolean
  readonly wireSigInt?: boolean
  /** 以下透传 reviewTask 的测试注入项（git / 全局文档 / id 分配）。 */
  readonly gitMergePort?: GitMergePort
  readonly globalDocRepo?: GlobalDocRepositoryPort
  readonly idAllocator?: IdAllocator
}

/**
 * CLI action 入口：assembleReviewer → reviewTask → 合并 cost 摘要（§7）。
 *
 * 把 composition root（profile → reviewer + 可观测性）与 reviewTask 编排串联：审查后把可观测性
 * 采集的 cost/usage 并入 TaskReviewOutcome（SDK 路径非空、LocalReviewer 为 undefined）。observability
 * 经 finally 关闭（移除 SIGINT 监听，避免跨命令泄漏）。对称 task-run.ts runTaskWithAssembly。
 */
export async function reviewTaskWithAssembly(
  taskId: TaskId,
  options: ReviewTaskWithAssemblyOptions = {},
): Promise<TaskReviewOutcome> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd())
  const { reviewer, observability } = assembleReviewer({
    projectRoot,
    taskId,
    provider: options.provider,
    model: options.model,
    reviewerKind: options.reviewer,
    configPath: options.configPath,
    env: options.env,
    reviewerFactory: options.reviewerFactory,
    stream: options.stream,
    wireSigInt: options.wireSigInt,
  })
  try {
    const outcome = await reviewTask(taskId, {
      projectRoot,
      mainRef: options.mainRef,
      worktreesDir: options.worktreesDir,
      reviewer,
      gitMergePort: options.gitMergePort,
      globalDocRepo: options.globalDocRepo,
      idAllocator: options.idAllocator,
    })
    return { ...outcome, cost: observability.getCost() }
  } finally {
    observability.close()
  }
}

/* ============================================================ *
 * commander 注册
 * ============================================================ */

/** commander 解析后的 task:review 选项。 */
interface TaskReviewCommandOptions {
  mainRef?: string
  worktreesDir?: string
  projectRoot?: string
  provider?: string
  model?: string
  reviewer?: string
  configPath?: string
}

/** 校验 --reviewer 取值（local | sdk | 省略=auto 读 profile，token 缺失回退 local）。 */
function parseReviewerKind(raw: string | undefined): 'local' | 'sdk' | undefined {
  if (raw === undefined) return undefined
  if (raw === 'local' || raw === 'sdk') return raw
  throw new Error(`--reviewer 只支持 local | sdk（收到「${raw}」）`)
}

/**
 * 向 commander program 注册 task:review 命令。
 * 退出码与错误输出归 framework.runCli 统一处理;本函数只负责命令签名与执行。
 *
 * CLI action 经 reviewTaskWithAssembly 装配（profile → reviewer + §7 可观测性）后调 reviewTask。
 * 默认（无 --reviewer）走 auto：profile token 就位 → ClaudeSdkReviewer;缺失 → 回退 LocalReviewer
 * （§12 兜底）。--provider/--model/--config 透传装配，--reviewer 显式控制审查器类型。
 */
export function registerTaskReviewCommand(program: Command): void {
  program
    .command('task:review')
    .description(
      '审查单个任务：.review.md → 状态映射（approved→done 合并;rejected/blocked 保留 worktree）',
    )
    .argument('<taskId>', '任务 id（TASK-XXX）')
    .option('--main-ref <ref>', '主分支短名（默认 main）')
    .option('--worktrees-dir <dir>', 'worktree 根目录（默认 <项目根>/.worktrees）')
    .option('--project-root <dir>', '项目根目录（默认当前工作目录）')
    .option('--provider <name>', '覆盖启用的 provider profile 名')
    .option('--model <name>', '覆盖具体模型名（直接写入 reviewer.model）')
    .option(
      '--reviewer <kind>',
      '审查器类型（local 兜底 | sdk 显式 | 省略=auto：读 profile，token 缺失回退 local）',
    )
    .option('--config <path>', 'provider profile 配置文件路径（默认 <项目根>/.caw/config.json）')
    .action(async (taskId: string, options: TaskReviewCommandOptions) => {
      const outcome = await reviewTaskWithAssembly(taskId, {
        projectRoot: options.projectRoot,
        mainRef: options.mainRef,
        worktreesDir: options.worktreesDir,
        provider: options.provider,
        model: options.model,
        reviewer: parseReviewerKind(options.reviewer),
        configPath: options.configPath,
      })
      printOutcome(outcome)
    })
}

/** 按最终状态输出审查结果（退出码统一由 framework.runCli 处理）。 */
function printOutcome(outcome: TaskReviewOutcome): void {
  console.log(
    `任务 ${outcome.taskId} 审查完成（reviewer=${outcome.reviewer}，结论=${outcome.reviewResult}）→ 状态: ${outcome.finalStatus}`,
  )
  if (outcome.merged) {
    console.log('已合并回主分支并回写全局文档（§3.2）')
  } else if (outcome.conflicts.length > 0) {
    console.log(
      `合并冲突，已置 blocked 并登记 ISSUES;冲突文件: ${outcome.conflicts.join(', ')}`,
    )
  } else {
    console.log('任务未进入 done，未触发合并（worktree 已保留，详情见 .review.md / ISSUES）')
  }
  // §7 cost 摘要（SDK 路径非空;LocalReviewer 无 SDK 会话不打印）。
  if (outcome.cost) {
    const c = outcome.cost
    console.log(
      `  cost: $${c.totalCostUsd.toFixed(6)}（input ${c.inputTokens} / output ${c.outputTokens}` +
        ` / cache+${c.cacheCreationInputTokens} / cache-${c.cacheReadInputTokens} tokens` +
        ` / ${c.numTurns} turns / ${c.durationMs}ms）`,
    )
  }
}
