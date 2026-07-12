import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Command } from 'commander'
import { parse as parseYaml } from 'yaml'
import {
  ExecuteTaskUseCase,
  StateOrchestrator,
  rebaseAndFastForward,
  writebackGlobalDocs,
  type IdAllocator,
  type MergePorts,
  type MergeTask,
  type WritebackRequest,
} from '../../application/index.js'
import type {
  GitMergePort,
  GlobalDocName,
  GlobalDocRepositoryPort,
} from '../../application/ports.js'
// TASK-036：执行契约（Port + 输入输出）自 application execution/ports 导入（单一来源）；
// 具体执行器实现类仍从 infrastructure 导入（composition root wiring）。
import type { TaskExecutorPort } from '../../application/execution/ports.js'
import type {
  Layer,
  Permission,
  TaskFrontmatter,
  TaskId,
  TaskStatus,
  TestingCommand,
} from '../../core/index.js'
import {
  ClaudeSdkExecutor,
  ClaudeSdkInvocationImpl,
  DryRunLocalExecutor,
  GitMergeAdapter,
  GlobalDocRepository,
  TaskDocRepository,
  WorktreeAdapter,
  type ClaudeSdkInvocation,
} from '../../infrastructure/index.js'
import {
  DEFAULT_CONFIG_PATH,
  composeProviderEnv,
  readProfileConfig,
} from '../config/provider-profile.js'
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * `task:run` 命令：单个任务的执行 composition root（Readme.md §11 / §3.2 / §17）。
 *
 * 职责（TASK-037 起）：「执行阶段」（依赖检查 → 刷新 context_pack → ready→running →
 * worktree → R7 → Executor → 读 .result.md → applyResult 状态映射）委托
 * ExecuteTaskUseCase（application/execution/execute-task.ts）；本文件只负责：
 *   - composition root 装配：infrastructure 实现（TaskDocRepository / WorktreeAdapter /
 *     DryRunLocalExecutor / ClaudeSdkExecutor / GitMergeAdapter / GlobalDocRepository）wiring
 *     注入 ExecuteTaskPorts；provider/observability 组装（assembleExecutor）。
 *   - 合并回收阶段（done 路径）：rebaseAndFastForward（TASK-019）+ writebackGlobalDocs
 *     （TASK-020）+ syncMainWorktreeFile；冲突 → blocked + appendMergeConflictIssue。
 *   - 参数解析与 commander 注册。
 *
 * 合并触发规则（§9 数据流 / 任务 §2）：
 *   - 普通任务执行后停在 `reviewing`，**不合并**，提示运行 `task:review`。
 *   - `no_review: true` 且 Orchestrator 校验产物通过、目标状态为 `done` 时，才触发合并回收
 *     （rebase + 回填 + fast-forward，TASK-019）+ 全局文档 section 回写（TASK-020）。
 *   - 合并冲突：`done → blocked`（Orchestrator 确认）+ 把冲突登记进 docs/ISSUES.md（§3.2/§8 不静默）。
 *
 * 分层定位（ARCHITECTURE.md §4 / 任务 §8）：CLI 是 composition root——只编排 application +
 * infrastructure，不持有状态机、不重复领域规则。执行阶段领域编排自 TASK-037 起收敛到
 * ExecuteTaskUseCase（本文件不再持有可复用的依赖检查 / Context Pack / 权限边界 / 状态映射逻辑）；
 * 合并阶段待 TASK-038 抽取为共享 Finalize 用例。对 infra 的依赖在 ports 结构类型兼容下由本文件 wiring 注入。
 *
 * 幂等恢复（TASK-021 recoverMerge）：单次成功执行的新鲜合并走 019+020；recoverMerge 以
 * `branchMerged` 为分叉点，对 DryRun 这类「产出未提交 .result.md」的新鲜执行，baseline 处
 * branchMerged 恒真会误判为「已合并」而跳过合并，故 recoverMerge 留作**崩溃后续跑**入口
 *（重入 task:run 时由上层按 git 状态触发），本命令的单次成功路径不调用它。
 *
 * 权威来源：根目录 Readme.md §11（执行流程）/ §3.2（worktree 合并策略）/ §17（失败恢复）。
 */

/** 默认主分支短名（§3.2）。 */
const DEFAULT_MAIN_REF = 'main'
/** 默认 worktree 根目录（相对项目根）。 */
const DEFAULT_WORKTREES_REL = '.worktrees'

/* ============================================================ *
 * 结果与选项类型
 * ============================================================ */

/** `task:run` 的执行结果（供命令层输出 / 测试断言）。 */
export interface TaskRunOutcome {
  readonly taskId: TaskId
  /** 执行 + 状态流转后的最终任务状态（reviewing / done / blocked / failed）。 */
  readonly finalStatus: TaskStatus
  /** 执行器名称（dry-run-local / claude-sdk，供日志区分）。 */
  readonly executor: string
  /** worktree 绝对路径。 */
  readonly worktreePath: string
  /** 是否触发了合并回收（仅 done 路径成功合并时为 true）。 */
  readonly merged: boolean
  /** 合并冲突文件清单（仅合并冲突时非空）。 */
  readonly conflicts: readonly string[]
  /**
   * §7 cost/usage 摘要（采集自 SDK result 消息，写入本字段供 CLI 输出与测试断言）。
   * SDK 路径下非空；DryRun / 无 result 消息到达时为 undefined（§7 cost 取自 result 消息）。
   */
  readonly cost?: CostSummary
}

/**
 * runTask 的可注入依赖。
 *
 * 默认全部接真实适配器（DryRunLocalExecutor / 真实 GitMergeAdapter / 文件系统全局文档仓储 /
 * 顺序 id 分配器）；测试可注入 fake 以隔离 git / SDK / 全局文档（复用 TASK-025 / 021 测试模式）。
 */
export interface TaskRunOptions {
  /** 项目根目录（默认当前工作目录）。 */
  readonly projectRoot?: string
  /** 主分支短名（默认 main）。 */
  readonly mainRef?: string
  /** worktree 根目录（默认 <项目根>/.worktrees）。 */
  readonly worktreesDir?: string
  /** Task Executor（默认 DryRunLocalExecutor；SDK 就位后由上层注入 ClaudeSdkExecutor）。 */
  readonly executor?: TaskExecutorPort
  /** 合并用 git 原语 Port（默认真实 GitMergeAdapter；测试可注入 fake 模拟冲突）。 */
  readonly gitMergePort?: GitMergePort
  /** 全局文档读写 Port（默认文件系统适配器；测试可注入内存版）。 */
  readonly globalDocRepo?: GlobalDocRepositoryPort
  /** DEC-XXX / ISS-XXX id 分配器（默认顺序分配）。 */
  readonly idAllocator?: IdAllocator
  /** R7 node_modules 恢复策略（默认 restoreNodeModules；测试可注入 no-op）。 */
  readonly nodeModulesRestorer?: (
    wtPath: string,
    mainRepo: string,
    permissions: readonly Permission[],
  ) => void
  /** 项目级验证命令声明（默认从 docs/TESTING.md 解析；测试可注入）。 */
  readonly testingCommands?: readonly TestingCommand[]
}

/* ============================================================ *
 * 公开 API：runTask
 * ============================================================ */

/**
 * 执行单个任务（Readme.md §11 / §3.2）—— composition root 入口。
 *
 * TASK-037 起，「执行阶段」（依赖检查 → 刷新 context_pack → ready→running → worktree →
 * R7 → Executor → 读 .result.md → applyResult 状态映射）委托 ExecuteTaskUseCase；本函数
 * 只负责装配 ExecuteTaskPorts（main 仓储 / worktree / executor / worktree 仓储 / R7 准备）、
 * 解析 testingCommands，并承接 done 路径的「合并回收」阶段（rebase + ff + 全局回写 + 主工作区
 * 同步；冲突 → blocked + ISSUES）。合并阶段待 TASK-038 抽取为共享 Finalize 用例。
 *
 * 状态权威在 main 仓库 frontmatter（TaskDocRepository 读写）；执行产物在 worktree（Executor
 * 写、合并经 rebase+ff 回收进 main）。reviewing 不合并；done（no_review 校验通过）才合并。
 */
export async function runTask(
  taskId: TaskId,
  options: TaskRunOptions = {},
): Promise<TaskRunOutcome> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd())
  const mainRef = options.mainRef ?? DEFAULT_MAIN_REF
  const worktreesDir = resolve(options.worktreesDir ?? join(projectRoot, DEFAULT_WORKTREES_REL))
  const executor = options.executor ?? new DryRunLocalExecutor()
  const globalRepo = options.globalDocRepo ?? createFsGlobalDocRepo(projectRoot)
  const idAllocator = options.idAllocator ?? sequentialIdAllocator()

  const tasksDir = join(projectRoot, 'docs', 'tasks')
  if (!existsSync(tasksDir)) {
    throw new Error(`任务目录不存在: ${tasksDir}（请先在项目根运行 caw init）`)
  }

  const testingCommands =
    options.testingCommands ?? parseTestingCommands(readOptional(join(projectRoot, 'docs', 'TESTING.md')))

  // 装配 ExecuteTaskPorts（composition root：infrastructure 实现 wiring 注入 application 用例）。
  // main 仓储 = 任务状态权威；worktree 仓储（openWorktreeRepo）专读 Executor 产出的 .result.md
  // （§12 主/worktree 显式区分，不用路径判断隐式路由）；prepareWorktree 绑定 projectRoot 适配 R7。
  const taskRepo = new TaskDocRepository(tasksDir)
  const restorer = options.nodeModulesRestorer ?? restoreNodeModules
  const useCase = new ExecuteTaskUseCase({
    taskRepo,
    worktree: new WorktreeAdapter(projectRoot, worktreesDir),
    executor,
    openWorktreeRepo: (wtPath) => new TaskDocRepository(join(wtPath, 'docs', 'tasks')),
    prepareWorktree: (wtPath, permissions) => restorer(wtPath, projectRoot, permissions),
  })

  // 执行阶段（领域编排全部在用例内）→ 结构化结果（finalStatus / worktreePath / task / result）。
  const executed = await useCase.execute({ taskId, mainRef, testingCommands })

  // 合并阶段（done 路径）—— composition root 承接，待 TASK-038 抽取共享 Finalize 用例。
  // reviewing 不合并；冲突 / 失败不在此分支合并。
  let merged = false
  let conflicts: string[] = []
  if (executed.finalStatus === 'done') {
    const mergeOutcome = rebaseAndFastForwardMerge({
      git: options.gitMergePort ?? new GitMergeAdapter(projectRoot, worktreesDir),
      wtPath: executed.worktreePath,
      task: executed.task,
      mainRef,
    })
    if (mergeOutcome.merged) {
      // 合并成功 → 全局文档 section 回写（§3.2 串行回写 global_update_requests）。
      const writebackRequest: WritebackRequest = {
        task_id: taskId,
        updates: executed.result.global_update_requests,
      }
      writebackGlobalDocs(globalRepo, [writebackRequest], { idAllocator })
      // fastForwardMain 用 update-ref 移动 ref、不检出工作区；把已进 main 历史的结果文件
      // 同步到主工作区（仅该文件，不动任务 status 工作区写回）。
      syncMainWorktreeFile(projectRoot, mainRef, executed.task.workflow_outputs.result_file)
      merged = true
    } else {
      conflicts = [...mergeOutcome.conflicts]
      // 合并冲突：done → blocked（Orchestrator 确认）+ 落 ISSUES（§3.2/§8 不静默）。
      const orchestrator = new StateOrchestrator(taskRepo)
      orchestrator.transition(taskId, 'blocked', {
        no_review: executed.task.no_review,
        confirmed: true,
      })
      appendMergeConflictIssue(globalRepo, idAllocator, taskId, conflicts)
    }
  }

  const finalStatus = taskRepo.readTask(taskId).status
  return {
    taskId,
    finalStatus,
    executor: executed.executor,
    worktreePath: executed.worktreePath,
    merged,
    conflicts,
  }
}

/* ============================================================ *
 * 合并回收（TASK-019 rebase-ff）
 * ============================================================ */

/** rebaseAndFastForwardMerge 的输入（git 原语 Port + worktree 路径 + 任务投影 + 主分支）。 */
interface MergeInput {
  readonly git: GitMergePort
  readonly wtPath: string
  readonly task: TaskFrontmatter
  readonly mainRef: string
}

/**
 * 在 worktree 内执行 rebase + 回填 + fast-forward 合并（TASK-019）。
 *
 * docs Port 路由到 worktree 的 docs/tasks（ISS-009：合并读 / 写 .result.md 在 worktree 内）。
 * 返回 merged=true（已 ff 进 main）/ merged=false + 冲突清单（供调用方置 blocked + 落 ISSUES）。
 */
function rebaseAndFastForwardMerge(input: MergeInput): {
  merged: boolean
  conflicts: readonly string[]
} {
  const docs: MergePorts['docs'] = new TaskDocRepository(join(input.wtPath, 'docs', 'tasks'))
  const ports: MergePorts = { git: input.git, docs }
  const mergeTask: MergeTask = {
    id: input.task.id,
    depends_on: input.task.depends_on,
    workflow_outputs: { result_file: input.task.workflow_outputs.result_file },
  }
  const outcome = rebaseAndFastForward(ports, [mergeTask], { mainRef: input.mainRef })
  const own = outcome.results.find((r) => r.taskId === input.task.id)
  if (own === undefined) {
    // 单任务合并必产出本任务结果；到此处属异常，不静默。
    throw new Error(`合并未产出 ${input.task.id} 的结果`)
  }
  if (own.ok) return { merged: true, conflicts: [] }
  return { merged: false, conflicts: own.conflicts }
}

/* ============================================================ *
 * R7：node_modules 恢复
 * ============================================================ */

/**
 * R7 策略：恢复 worktree 内 node_modules（PLAN R7 / 任务 §2）。
 *
 * 串行默认复用主工作区 node_modules（避免每个 worktree 重装的昂贵代价）；仅当任务声明
 * `install_dependencies` 能力时在 worktree 内重装（npm install）。复用优先用 junction / symlink
 * 把主工作区 node_modules 暴露给 worktree（不复制，避免慢与磁盘占用）。
 *
 * 不静默兜底：主工作区无 node_modules 且未声明 install_dependencies 时不做操作（后续验证命令
 * 若因缺依赖失败，由执行器 / 验证结果如实记录，本层不伪造依赖就绪）。
 */
export function restoreNodeModules(
  wtPath: string,
  mainRepo: string,
  permissions: readonly Permission[],
): void {
  const mainNm = join(mainRepo, 'node_modules')
  const wtNm = join(wtPath, 'node_modules')

  // 声明 install_dependencies → 在 worktree 内重装（R7「否则按 install_dependencies 重装」）。
  if (permissions.includes('install_dependencies')) {
    const r = spawnSync('npm', ['install'], { cwd: wtPath, stdio: 'ignore' })
    if (r.status !== 0) {
      throw new Error(
        `worktree 内 npm install 失败（退出码 ${r.status ?? 'null'}），路径: ${wtPath}`,
      )
    }
    return
  }

  // 串行默认：复用主工作区 node_modules（主工作区存在且 worktree 尚无时建立链接）。
  if (!existsSync(mainNm) || existsSync(wtNm)) return
  // junction：Windows 目录链接（无需管理员权限；POSIX 上 type 被忽略，创建常规 symlink）。
  try {
    symlinkSync(mainNm, wtNm, 'junction')
    return
  } catch {
    // junction 失败（非 Windows 或权限不足）→ 回退常规目录 symlink。
  }
  try {
    symlinkSync(mainNm, wtNm, 'dir')
  } catch (err) {
    throw new Error(
      `无法为 worktree 链接 node_modules（${wtNm} → ${mainNm}）：` +
        `${err instanceof Error ? err.message : String(err)}。` +
        '请声明 install_dependencies 能力由 worktree 内重装，或预置 node_modules。',
    )
  }
}

/* ============================================================ *
 * 全局文档（fs 适配器 + 冲突 ISSUES 登记 + 主工作区同步）
 * ============================================================ */

/**
 * 文件系统版 GlobalDocRepositoryPort：文件 I/O 走 docs/{PROGRESS,DECISIONS,ISSUES}.md，
 * 正文变换委托真实 GlobalDocRepository（复用 TASK-012 原语，不重复实现，DEC-012）。
 */
export function createFsGlobalDocRepo(projectRoot: string): GlobalDocRepositoryPort {
  const paths: Record<GlobalDocName, string> = {
    progress: join(projectRoot, 'docs', 'PROGRESS.md'),
    decisions: join(projectRoot, 'docs', 'DECISIONS.md'),
    issues: join(projectRoot, 'docs', 'ISSUES.md'),
  }
  const repo = new GlobalDocRepository()
  return {
    readGlobalDoc: (name) => readOptional(paths[name]),
    writeGlobalDoc: (name, content) => {
      writeFileSync(paths[name], content, 'utf8')
    },
    applyProgressUpdate: (doc, update) => repo.applyProgressUpdate(doc, update),
    appendDecision: (doc, decision) => repo.appendDecision(doc, decision),
    appendIssue: (doc, issue) => repo.appendIssue(doc, issue),
    readDecisions: (doc) => repo.readDecisions(doc),
    readIssues: (doc) => repo.readIssues(doc),
  }
}

/**
 * 把合并冲突登记进 docs/ISSUES.md（§3.2 / 任务 §8 不静默）。
 *
 * 经 idAllocator 分配 ISS-XXX（既有非空 id ∪ 本批次去重）后 appendIssue 写回。
 * 冲突清单（unmerged 文件）记入 recommended_action 供人工定位。
 */
function appendMergeConflictIssue(
  globalRepo: GlobalDocRepositoryPort,
  idAllocator: IdAllocator,
  taskId: TaskId,
  conflicts: readonly string[],
): void {
  const issuesDoc = globalRepo.readGlobalDoc('issues')
  const usedIds = collectExistingIds(globalRepo.readIssues(issuesDoc))
  const id = idAllocator.nextIssueId(usedIds)
  const updated = globalRepo.appendIssue(issuesDoc, {
    id,
    title: `${taskId} 合并冲突`,
    status: 'open',
    severity: 'high',
    scope: taskId,
    created_from_task: taskId,
    owner: '',
    recommended_action: `解决 rebase 合并冲突后重跑 caw task:run ${taskId}；冲突文件: ${conflicts.join(', ')}`,
  })
  globalRepo.writeGlobalDoc('issues', updated)
}

/** 合并后把已进入 main 历史的结果文件同步到主工作区（fastForwardMain 用 update-ref，工作区不自动检出）。 */
function syncMainWorktreeFile(mainRepoDir: string, mainRef: string, resultFileRel: string): void {
  // 仅检出该文件到主工作区 + 索引；不动其余工作区改动（如任务 status 写回）。
  const r = spawnSync('git', ['checkout', mainRef, '--', resultFileRel], {
    cwd: mainRepoDir,
    stdio: 'ignore',
  })
  if (r.status !== 0) {
    // 同步失败不阻断（合并已成功进 main 历史），但显式告警（AGENTS §4 不静默）。
    console.warn(
      `warning: 同步主工作区结果文件失败（${resultFileRel}，退出码 ${r.status ?? 'null'}）；` +
        '该文件已在 main 历史中，可经 git checkout 手动检出。',
    )
  }
}

/* ============================================================ *
 * 纯辅助函数
 * ============================================================ */

/** 从既有条目数组收集非空 id 集合（id 分配去重基线，镜像 section-writeback.collectExistingIds）。 */
function collectExistingIds(entries: ReadonlyArray<{ id: string }>): Set<string> {
  const set = new Set<string>()
  for (const e of entries) {
    if (e.id !== '') set.add(e.id)
  }
  return set
}

/** 顺序 id 分配器：同前缀（DEC / ISS）现有最大编号 +1，三位补零（与 recovery 测试一致）。 */
export function sequentialIdAllocator(): IdAllocator {
  const next = (used: ReadonlySet<string>, prefix: 'DEC' | 'ISS'): string => {
    const re = prefix === 'DEC' ? /^DEC-(\d+)$/ : /^ISS-(\d+)$/
    let max = 0
    for (const id of used) {
      const m = re.exec(id)
      if (m?.[1] !== undefined) max = Math.max(max, Number(m[1]))
    }
    return `${prefix}-${String(max + 1).padStart(3, '0')}`
  }
  return {
    nextDecisionId: (used) => next(used, 'DEC'),
    nextIssueId: (used) => next(used, 'ISS'),
  }
}

/** 读取文件内容；不存在返回空串（readDecisions / readIssues 对无 fenced yaml 返回空数组）。 */
function readOptional(filePath: string): string {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
}

/**
 * 解析 docs/TESTING.md 的 fenced ```yaml 块为项目级验证命令声明（§6.8 / §16）。
 *
 * TESTING.md 每条命令以 ```yaml 围栏声明 {command, layers?, requires_permissions?, notes}；
 * 本函数提取前三个字段（notes 忽略），不能解析的块跳过。无 TESTING.md 时返回空数组。
 */
export function parseTestingCommands(raw: string): TestingCommand[] {
  if (raw.length === 0) return []
  const lines = raw.split(/\r?\n/)
  const commands: TestingCommand[] = []
  let i = 0
  while (i < lines.length) {
    if ((lines[i] ?? '').trim().toLowerCase() === '```yaml') {
      // 找配对闭围栏；无闭围栏则跳过残缺块。
      let j = i + 1
      while (j < lines.length && (lines[j] ?? '').trim() !== '```') j++
      if (j >= lines.length) {
        i += 1
        continue
      }
      const yamlText = lines.slice(i + 1, j).join('\n')
      i = j + 1
      let obj: unknown
      try {
        obj = parseYaml(yamlText)
      } catch {
        continue
      }
      const cmd = toTestingCommand(obj)
      if (cmd !== null) commands.push(cmd)
    } else {
      i += 1
    }
  }
  return commands
}

/** 把单个 YAML 解析对象窄化为 TestingCommand（command 必填且为字符串；layers / permissions 过滤为字符串数组）。 */
function toTestingCommand(obj: unknown): TestingCommand | null {
  if (obj === null || typeof obj !== 'object' || !('command' in obj)) return null
  const o = obj as { command?: unknown; layers?: unknown; requires_permissions?: unknown }
  if (typeof o.command !== 'string') return null
  return {
    command: o.command,
    layers: toStringArray(o.layers) as Layer[] | undefined,
    requires_permissions: toStringArray(o.requires_permissions) as Permission[] | undefined,
  }
}

/** 把未知值窄化为字符串数组（非数组 → undefined；数组 → 过滤出字符串）。 */
function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((x): x is string => typeof x === 'string')
}

/* ============================================================ *
 * §7 可观测性（F5 安全绳：流式终端 + 完整日志 + cost 摘要 + §9 SIGINT 中断）
 * ============================================================ */

/**
 * §7 cost/usage 摘要（采集自 SDK result 消息，写入 TaskRunOutcome 供 CLI 输出与测试断言）。
 *
 * 字段名映射到 SdkSessionReport / SDKResultMessage（§12 终止字段，对照安装版 .d.ts）。
 */
export interface CostSummary {
  /** 本次会话总成本（美元，result.total_cost_usd）。 */
  readonly totalCostUsd: number
  /** 输入 token 数。 */
  readonly inputTokens: number
  /** 输出 token 数。 */
  readonly outputTokens: number
  /** 缓存写入 token 数。 */
  readonly cacheCreationInputTokens: number
  /** 缓存读取 token 数。 */
  readonly cacheReadInputTokens: number
  /** 会话轮次数（result.num_turns）。 */
  readonly numTurns: number
  /** 会话墙钟时长毫秒（result.duration_ms）。 */
  readonly durationMs: number
}

/** createObservability 选项。 */
export interface ObservabilityOptions {
  readonly projectRoot: string
  readonly taskId: TaskId
  /** 是否实时渲染到终端（默认 true；测试可关闭避免 console 噪声）。 */
  readonly stream?: boolean
  /** 是否把 abortController wire 进程 SIGINT（默认 true；测试可关闭）。 */
  readonly wireSigInt?: boolean
  /** 注入的时间戳源（测试确定性）。 */
  readonly now?: () => Date
}

/**
 * §7 可观测性上下文：流式渲染 + 日志落盘 + cost 采集 + §9 SIGINT abort。
 *
 * 三项可见性经 SDK 流式回调（onMessage）驱动，回调注入 invocation（TASK-032）→ sdk-client
 * （TASK-030）for-await 透传每条 SDKMessage：
 *  - 实时流式：assistant（text/tool_use）/ user（tool_result）消息打印到终端（§7.1）；
 *  - 完整日志：逐消息（含 ISO 时间戳、轮次序号、类型、JSON）追加到 .caw/logs/<task>-<ts>.log（§7.2）；
 *  - cost 摘要：result 消息到达时采集 total_cost_usd / usage / num_turns / duration_ms（§7.3）。
 *
 * 中断（§9）：abortController wire 进程 SIGINT（Ctrl+C → controller.abort() → SDK 抛 AbortError，
 * invocation catch 产降级 result）；close() 移除监听，避免跨命令泄漏。
 */
export interface Observability {
  /** SDKMessage 流式回调（注入 invocation，§7 三项可见性汇集于此）。 */
  readonly onMessage: (message: SDKMessage) => void
  /** 子进程 stderr 回调（注入 invocation，§7 日志落盘）。 */
  readonly stderr: (data: string) => void
  /** SIGINT 接入的中断控制器（注入 invocation，§9）。 */
  readonly abortController: AbortController
  /** 日志文件绝对路径（§7.2 完整日志；文件在首条消息到达时惰性创建，DryRun 无消息则不产空文件）。 */
  readonly logFile: string
  /** 取采集到的 cost（result 消息到达后非空；DryRun / 未到达为 undefined）。 */
  getCost(): CostSummary | undefined
  /** 收尾：移除 SIGINT 监听（日志经 appendFileSync 无需显式关闭句柄）。 */
  close(): void
}

/**
 * 创建 §7 可观测性上下文（F5 安全绳）。
 *
 * 日志文件惰性创建（首条消息时 mkdirSync + appendFileSync）：DryRun 不产 SDK 消息 → 不留空日志。
 * 轮次按 assistant 消息计数（模型一次完整回复 = 一轮），写入日志的 turn 字段供事后审计定位。
 */
export function createObservability(options: ObservabilityOptions): Observability {
  const stream = options.stream ?? true
  const wireSigInt = options.wireSigInt ?? true
  const now = options.now ?? (() => new Date())
  const abortController = new AbortController()
  const logFile = join(options.projectRoot, '.caw', 'logs', `${options.taskId}-${now().getTime()}.log`)

  let cost: CostSummary | undefined
  let turn = 0
  let logReady = false

  /** 惰性创建日志目录 + 追加一行（首条消息时建目录，无消息则不产空文件）。 */
  function appendLog(line: string): void {
    if (!logReady) {
      mkdirSync(dirname(logFile), { recursive: true })
      logReady = true
    }
    appendFileSync(logFile, line + '\n', 'utf8')
  }

  const onMessage = (message: SDKMessage): void => {
    const ts = now().toISOString()
    // 轮次：assistant 消息计一轮（模型一次回复 = 一轮）。
    if (message.type === 'assistant') turn += 1
    // 完整日志：时间戳 | 轮次 | 类型 | JSON（§7.2 逐消息审计依据）。
    appendLog(`${ts} | turn ${turn} | ${message.type} | ${safeJson(message)}`)
    // 终端流式渲染（仅 assistant / user 有输出，stream_event / system 等仅入日志）。
    if (stream) {
      for (const line of renderMessage(message)) console.log(line)
    }
    // cost 采集（result 消息携带会话终止统计）。
    if (message.type === 'result') {
      cost = extractCost(message)
    }
  }

  const stderr = (data: string): void => {
    appendLog(`${now().toISOString()} | stderr | ${data}`)
  }

  const onSigInt = (): void => {
    abortController.abort()
  }
  if (wireSigInt) {
    process.on('SIGINT', onSigInt)
  }

  return {
    onMessage,
    stderr,
    abortController,
    logFile,
    getCost: () => cost,
    close: () => {
      if (wireSigInt) process.off('SIGINT', onSigInt)
    },
  }
}

/** §7.1 终端流式渲染：把 SDKMessage 渲染为可读行（仅 assistant / user 有输出，其余返回空数组）。 */
function renderMessage(message: SDKMessage): string[] {
  if (message.type === 'assistant') {
    return renderAssistantContent(message.message.content)
  }
  if (message.type === 'user') {
    return renderUserContent(message.message.content)
  }
  return []
}

/** assistant 消息内容块渲染：text 截断打印 + tool_use 打印工具名 + 输入摘要（路径/命令）。 */
function renderAssistantContent(content: ReadonlyArray<{ type: string }>): string[] {
  const lines: string[] = []
  for (const block of content) {
    if (block.type === 'text') {
      // 经 type 判别后窄化为 text 块结构（content 入参为渲染宽类型，非 SDK 精确块联合）。
      const b = block as unknown as { text: string }
      const t = b.text.trim()
      if (t !== '') lines.push(`  💬 ${truncate(t, 120)}`)
    } else if (block.type === 'tool_use') {
      const b = block as unknown as { name: string; input: unknown }
      lines.push(`  🔧 ${b.name}(${summarizeToolInput(b.input)})`)
    }
    // thinking / redacted_thinking 等不渲染（日志已留全量）。
  }
  return lines
}

/** user 消息内容块渲染：tool_result 打印结果状态（✓ / ✗）+ 内容截断。 */
function renderUserContent(content: string | ReadonlyArray<{ type: string }>): string[] {
  if (typeof content === 'string') {
    return content.trim() !== '' ? [`  ↳ ${truncate(content, 120)}`] : []
  }
  const lines: string[] = []
  for (const block of content) {
    if (block.type === 'tool_result') {
      const b = block as unknown as { is_error?: boolean; content?: unknown }
      const mark = b.is_error === true ? '✗ error' : '✓'
      lines.push(`  ↳ tool_result ${mark} ${truncate(summarizeToolResult(b.content), 100)}`)
    }
  }
  return lines
}

/** 从 SDK result 消息采集 cost/usage 摘要（§7.3，字段名对照安装版 .d.ts）。 */
function extractCost(result: SDKResultMessage): CostSummary {
  const usage = result.usage
  return {
    totalCostUsd: result.total_cost_usd,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    numTurns: result.num_turns,
    durationMs: result.duration_ms,
  }
}

/** 工具调用输入摘要：优先提取常见字段（file_path/command/path/pattern），否则 JSON 截断。 */
function summarizeToolInput(input: unknown): string {
  if (input === null || typeof input !== 'object') return truncate(String(input), 80)
  const obj = input as Record<string, unknown>
  for (const key of ['file_path', 'path', 'command', 'pattern']) {
    const v = obj[key]
    if (typeof v === 'string') return `${key}=${truncate(v, 60)}`
  }
  return truncate(safeJson(input), 80)
}

/** tool_result content 摘要（content 可能是 string 或内容块数组）。 */
function summarizeToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  return safeJson(content)
}

/** 折叠空白并截断到 max 字符（超长加省略号），供终端单行渲染。 */
function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim()
  return single.length > max ? single.slice(0, max) + '…' : single
}

/** 安全 JSON 序列化（含循环引用等不可序列化值时回退 String，不抛错）。 */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/* ============================================================ *
 * composition root：profile → env → invocation → executor（SPEC §6 / §13.2）
 * ============================================================ */

/** invocation 构造工厂类型（默认真实 ClaudeSdkInvocationImpl；测试注入 fake 验装配 + outcome）。 */
export type InvocationFactory = (opts: {
  readonly providerEnv: Readonly<Record<string, string>>
  readonly model?: string
  readonly onMessage?: (message: SDKMessage) => void
  readonly stderr?: (data: string) => void
  readonly abortController: AbortController
}) => ClaudeSdkInvocation

/** assembleExecutor 输入（composition root 装配参数）。 */
export interface AssembleExecutorInput {
  readonly projectRoot: string
  readonly taskId: TaskId
  /** --provider 覆盖启用的 profile 名。 */
  readonly provider?: string
  /** --model 覆盖具体模型名（直接写入 invocation.model，SPEC §6「覆盖具体模型」）。 */
  readonly model?: string
  /** --executor：'dry-run' 显式回退；'sdk' 显式 SDK；省略 = auto（token 就位走 SDK，否则报错）。 */
  readonly executorKind?: 'dry-run' | 'sdk'
  /** 配置文件路径（默认 <projectRoot>/.caw/config.json）。 */
  readonly configPath?: string
  /** 环境来源（默认 process.env；测试注入隔离真实环境）。 */
  readonly env?: NodeJS.ProcessEnv
  /** invocation 构造工厂（默认真实 ClaudeSdkInvocationImpl；测试注入 fake）。 */
  readonly invocationFactory?: InvocationFactory
  /** 透传 createObservability 的开关（测试关闭终端渲染 / SIGINT wiring）。 */
  readonly stream?: boolean
  readonly wireSigInt?: boolean
}

/** assembleExecutor 结果：executor + 可观测性上下文（cost 采集自后者，§7）。 */
export interface AssembledExecutor {
  readonly executor: TaskExecutorPort
  readonly observability: Observability
}

/**
 * composition root（SPEC §6 / §13.2）：读 profile → 组装 env → 构造 invocation → 注入 ClaudeSdkExecutor。
 *
 * 装配策略（SPEC §14.3）：
 *  - `--executor dry-run`：不读 token，直接 DryRunLocalExecutor（仍建可观测性，无 SDK 会话则 cost=undefined）；
 *  - `--executor sdk` 或 auto：readProfileConfig → composeProviderEnv（token 缺失由 buildProviderEnv
 *    抛 ProviderTokenMissingError → 不静默，§6 key 缺失）→ 构造 ClaudeSdkInvocationImpl + ClaudeSdkExecutor。
 *
 * `--model` 作为具体模型名直接写入 invocation.model（SPEC §6「覆盖具体模型，写入 options.model」），
 * 省略则 invocation.model 为 undefined → SDK 经 ANTHROPIC_DEFAULT_*_MODEL env 按档位自选。
 *
 * 可观测回调（onMessage/stderr/abortController）注入 invocation，sdk-client 透传 SDKMessage 流。
 */
export function assembleExecutor(input: AssembleExecutorInput): AssembledExecutor {
  if (
    input.executorKind !== undefined &&
    input.executorKind !== 'dry-run' &&
    input.executorKind !== 'sdk'
  ) {
    throw new Error(`--executor 只支持 dry-run | sdk（收到「${input.executorKind}」）`)
  }

  const observability = createObservability({
    projectRoot: input.projectRoot,
    taskId: input.taskId,
    stream: input.stream,
    wireSigInt: input.wireSigInt,
  })

  // 显式 dry-run → 不读 token，直接回退（§14.3「--executor dry-run 显式回退 DryRun」）。
  if (input.executorKind === 'dry-run') {
    return { executor: new DryRunLocalExecutor(), observability }
  }

  // sdk / auto：读 profile + 组装 env（token 缺失由 buildProviderEnv 抛错，不静默，§6 key 缺失）。
  const configPath = input.configPath ?? join(input.projectRoot, DEFAULT_CONFIG_PATH)
  const config = readProfileConfig(configPath)
  const providerEnv = composeProviderEnv(config, {
    providerOverride: input.provider,
    env: input.env,
  })

  const factory = input.invocationFactory ?? defaultInvocationFactory
  const invocation = factory({
    providerEnv,
    model: input.model,
    onMessage: observability.onMessage,
    stderr: observability.stderr,
    abortController: observability.abortController,
  })
  return { executor: new ClaudeSdkExecutor(invocation), observability }
}

/** 默认 invocation 工厂：构造真实 ClaudeSdkInvocationImpl（注入 provider env + 可观测回调 + abortController）。 */
const defaultInvocationFactory: InvocationFactory = (opts) =>
  new ClaudeSdkInvocationImpl({
    providerEnv: { ...opts.providerEnv },
    model: opts.model,
    onMessage: opts.onMessage,
    stderr: opts.stderr,
    abortController: opts.abortController,
  })

/** runTaskWithAssembly 选项（CLI action 传参，组合装配 + 编排注入）。 */
export interface RunTaskWithAssemblyOptions {
  readonly projectRoot?: string
  readonly mainRef?: string
  readonly worktreesDir?: string
  readonly provider?: string
  readonly model?: string
  readonly executor?: 'dry-run' | 'sdk'
  readonly configPath?: string
  readonly env?: NodeJS.ProcessEnv
  readonly invocationFactory?: InvocationFactory
  readonly stream?: boolean
  readonly wireSigInt?: boolean
  /** 以下透传 runTask 的测试注入项（git / 全局文档 / id 分配 / node_modules / 验证命令声明）。 */
  readonly gitMergePort?: GitMergePort
  readonly globalDocRepo?: GlobalDocRepositoryPort
  readonly idAllocator?: IdAllocator
  readonly nodeModulesRestorer?: (
    wtPath: string,
    mainRepo: string,
    permissions: readonly Permission[],
  ) => void
  readonly testingCommands?: readonly TestingCommand[]
}

/**
 * CLI action 入口：assembleExecutor → runTask → 合并 cost 摘要（§7）。
 *
 * 把 composition root（profile → executor + 可观测性）与 runTask 编排串联：执行后把可观测性
 * 采集的 cost/usage 并入 TaskRunOutcome（SDK 路径非空、DryRun 为 undefined）。observability 经
 * finally 关闭（移除 SIGINT 监听，避免跨命令泄漏）。
 */
export async function runTaskWithAssembly(
  taskId: TaskId,
  options: RunTaskWithAssemblyOptions = {},
): Promise<TaskRunOutcome> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd())
  const { executor, observability } = assembleExecutor({
    projectRoot,
    taskId,
    provider: options.provider,
    model: options.model,
    executorKind: options.executor,
    configPath: options.configPath,
    env: options.env,
    invocationFactory: options.invocationFactory,
    stream: options.stream,
    wireSigInt: options.wireSigInt,
  })
  try {
    const outcome = await runTask(taskId, {
      projectRoot,
      mainRef: options.mainRef,
      worktreesDir: options.worktreesDir,
      executor,
      gitMergePort: options.gitMergePort,
      globalDocRepo: options.globalDocRepo,
      idAllocator: options.idAllocator,
      nodeModulesRestorer: options.nodeModulesRestorer,
      testingCommands: options.testingCommands,
    })
    return { ...outcome, cost: observability.getCost() }
  } finally {
    observability.close()
  }
}

/* ============================================================ *
 * commander 注册
 * ============================================================ */

/** commander 解析后的 task:run 选项。 */
interface TaskRunCommandOptions {
  mainRef?: string
  worktreesDir?: string
  projectRoot?: string
  provider?: string
  model?: string
  executor?: string
  configPath?: string
}

/**
 * 校验 --executor 值：合法返回 'dry-run' | 'sdk'，省略返回 undefined，非法抛错（不静默）。
 */
function parseExecutorKind(raw: string | undefined): 'dry-run' | 'sdk' | undefined {
  if (raw === undefined) return undefined
  if (raw === 'dry-run' || raw === 'sdk') return raw
  throw new Error(`--executor 只支持 dry-run | sdk（收到「${raw}」）`)
}

/**
 * 向 commander program 注册 task:run 命令。
 * 退出码与错误输出归 framework.runCli 统一处理；本函数只负责命令签名与执行。
 *
 * `--provider` / `--model` / `--executor` / `--config` 经 runTaskWithAssembly 进入 composition root
 * （§6 profile → env → invocation → executor），其余选项（main-ref / worktrees-dir / project-root）透传。
 */
export function registerTaskRunCommand(program: Command): void {
  program
    .command('task:run')
    .description(
      '执行单个任务：ready→running→Executor→状态流转（done 免审合并；reviewing 待 task:review）',
    )
    .argument('<taskId>', '任务 id（TASK-XXX）')
    .option('--main-ref <ref>', '主分支短名（默认 main）')
    .option('--worktrees-dir <dir>', 'worktree 根目录（默认 <项目根>/.worktrees）')
    .option('--project-root <dir>', '项目根目录（默认当前工作目录）')
    .option('--provider <name>', '覆盖启用的 provider profile 名（默认 config.provider）')
    .option('--model <name>', '覆盖具体模型名（写入 SDK options.model）')
    .option('--executor <kind>', '执行器：dry-run | sdk（省略则按 token 就位自动）')
    .option('--config <path>', 'provider profile 配置文件路径（默认 .caw/config.json）')
    .action(async (taskId: string, options: TaskRunCommandOptions) => {
      const outcome = await runTaskWithAssembly(taskId as TaskId, {
        projectRoot: options.projectRoot,
        mainRef: options.mainRef,
        worktreesDir: options.worktreesDir,
        provider: options.provider,
        model: options.model,
        executor: parseExecutorKind(options.executor),
        configPath: options.configPath,
      })
      printOutcome(outcome)
    })
}

/** 按最终状态输出执行结果（退出码统一由 framework.runCli 处理）。 */
function printOutcome(outcome: TaskRunOutcome): void {
  console.log(
    `任务 ${outcome.taskId} 执行完成（executor=${outcome.executor}）→ 状态: ${outcome.finalStatus}`,
  )
  // §7.3 cost/usage 摘要（SDK 路径采集自 result 消息；DryRun 无 cost 字段）。
  if (outcome.cost !== undefined) {
    console.log(
      `  cost $${outcome.cost.totalCostUsd.toFixed(4)}，${outcome.cost.numTurns} 轮，` +
        `input ${outcome.cost.inputTokens}/output ${outcome.cost.outputTokens} tokens，` +
        `${outcome.cost.durationMs}ms`,
    )
  }
  if (outcome.finalStatus === 'reviewing') {
    console.log(`任务进入审查，请运行: caw task:review ${outcome.taskId}`)
  } else if (outcome.merged) {
    console.log('已合并回主分支并回写全局文档（§3.2）')
  } else if (outcome.conflicts.length > 0) {
    console.log(
      `合并冲突，已置 blocked 并登记 ISSUES；冲突文件: ${outcome.conflicts.join(', ')}`,
    )
  } else {
    console.log('任务未进入 done，未触发合并（详情见 .result.md / ISSUES）')
  }
}
