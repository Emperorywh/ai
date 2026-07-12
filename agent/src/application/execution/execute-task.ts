/**
 * 单任务执行 Application 用例（Readme.md §11 / §3.2 / 串行编排 SPEC §9 / §20.2）。
 *
 * 把原本堆在 CLI `task:run`（task-run.ts）中的可复用领域编排抽取为 application 层用例，
 * 为后续串行 Orchestrator（TASK-044）提供稳定、可测试的单任务执行入口：
 *   `TaskDoc → 依赖结果 → Context Pack → ready→running → Worktree → Executor → ResultDoc → 状态映射`
 *
 * 职责边界（任务 §2 / §9 / §11）：
 *   - 负责「执行阶段」全链：读任务（main 仓储）→ 状态/依赖前置 → 刷新 context_pack 并回写 →
 *     组装权限边界（路径重叠在 worktree 创建前拒绝）→ ready→running → 创建 worktree →
 *     R7 工作区准备 → 组装 §18 启动提示 → Executor 执行 → 读 .result.md（worktree 仓储）→
 *     applyResult 状态映射。
 *   - **不负责 review 与最终合并**：本用例在状态映射（reviewing / done / blocked / failed）后
 *     返回结构化结果；合并回收（rebase+ff+全局回写）与合并冲突登记留待 TASK-038 抽取共享
 *     Finalize 用例，当前仍由 CLI composition root 承接。
 *
 * 依赖方向（ARCHITECTURE.md §3 / §4 / 任务 §8）：`cli → application ← infrastructure`。
 *   - 本用例只依赖 core 领域原语与 application Ports（TaskDocRepositoryPort / WorktreePort /
 *     TaskExecutorPort），零 infrastructure 实现类导入。
 *   - 「在 worktree 路径打开文档仓储读 Executor 产出的 .result.md」与「R7 工作区准备」作为
 *     注入能力（openWorktreeRepo / prepareWorktree）由 CLI composition root wiring——用例不
 *     感知 worktree 内目录结构与 node_modules 恢复细节，避免隐式路由（任务 §12 风险点）。
 *   - main 文档仓储（任务状态权威）与 worktree 文档仓储（执行产物）在 Ports 层显式区分，
 *     不用路径判断或隐式路由：状态流转写回 main 仓储，.result.md 从 worktree 仓储读取。
 *
 * 权威来源：根目录 Readme.md §11（执行流程）/ §3.2（worktree 合并策略）/ §7（状态机）/
 * §10（执行结果映射）/ §16（权限模型）/ §18（启动提示）/ §8（Context Pack）。
 */
import { join } from 'node:path'
import type {
  Permission,
  ResultFrontmatter,
  TaskFrontmatter,
  TaskId,
  TaskStatus,
  TestingCommand,
} from '../../core/index.js'
import {
  computeVerificationAllowlist,
  resolvePathScope,
} from '../../core/index.js'
import type {
  TaskDocRepositoryPort,
  WorktreePort,
} from '../ports.js'
// 直接从具体 application 模块导入（不经 ../index.js），避免 application/index ↔ execution 的循环依赖。
import { StateOrchestrator } from '../state-orchestrator.js'
import {
  computeContextPack,
  refreshSourceFiles,
  type DependencyResultSummary,
} from '../context-pack-generator.js'
import type { TaskExecutorPort } from './ports.js'
import { buildStartupPrompt } from './ports.js'

/* ============================================================ *
 * 用例依赖（Ports）与输入输出
 * ============================================================ */

/**
 * ExecuteTaskUseCase 的注入依赖（任务 §2「经 Ports 注入」/ §11「fake Ports 覆盖完整执行链」）。
 *
 * 各 Port 由 CLI composition root（或串行 Orchestrator）wiring 具体实现后注入：
 *   - taskRepo：main 仓库文档仓储，任务状态权威——读任务 frontmatter、写回 status 与刷新后的
 *     context_pack、读依赖 .result.md，全部经此 Port（状态机不读 SQLite，§3.1）。
 *   - worktree：worktree 生命周期 Port，create 基于主分支基线返回 worktree 绝对路径（§3.2）。
 *   - executor：执行器 Port，在 worktree 内执行产出 .result.md（契约见 execution/ports.ts）。
 *   - openWorktreeRepo：在 worktree 路径下打开文档仓储，专用于读 Executor 刚写入的 .result.md
 *     （产物尚未合并入 main）。与 taskRepo 显式区分，避免用路径判断隐式路由（任务 §12 风险点）。
 *   - prepareWorktree：R7 工作区准备（恢复 worktree 内 node_modules 等）；签名只暴露 worktree
 *     路径与任务 permissions，主仓库路径等装配期常量由调用方在 wiring 时闭包绑定。
 */
export interface ExecuteTaskPorts {
  /** main 仓库文档仓储：任务状态权威（读写 frontmatter + 读依赖 result）。 */
  readonly taskRepo: TaskDocRepositoryPort
  /** worktree 生命周期 Port：create 返回 worktree 绝对路径。 */
  readonly worktree: WorktreePort
  /** 执行器 Port：在 worktree 内执行产出 .result.md。 */
  readonly executor: TaskExecutorPort
  /** 在 worktree 路径下打开文档仓储，读 Executor 产出的 .result.md（§12 主/worktree 显式区分）。 */
  readonly openWorktreeRepo: (wtPath: string) => TaskDocRepositoryPort
  /** R7 工作区准备（恢复 node_modules 等）；permissions 决定是否在 worktree 内重装依赖。 */
  readonly prepareWorktree: (wtPath: string, permissions: readonly Permission[]) => void
}

/** ExecuteTaskUseCase.execute 的调用参数（非注入依赖，每次执行可能不同）。 */
export interface ExecuteTaskInput {
  /** 要执行的任务 id。 */
  readonly taskId: TaskId
  /** 主分支短名（worktree 基线，默认 main）。 */
  readonly mainRef: string
  /** 项目级验证命令声明（组装权限边界 verification allowlist 用）。 */
  readonly testingCommands: readonly TestingCommand[]
}

/**
 * ExecuteTaskUseCase 的结构化阶段结果（任务 §9「用例返回结构化阶段结果」）。
 *
 * 携带合并阶段（TASK-038 Finalize）所需的一切：刷新后的任务投影、读到的 result、worktree 路径——
 * 使 CLI / Orchestrator 在 done 路径能继续 rebase+ff+回写，在 reviewing 路径能提示 task:review，
 * 无需重新读取或二次推导本用例已经计算的事实。
 */
export interface ExecuteTaskOutcome {
  /** 当前任务 id。 */
  readonly taskId: TaskId
  /** applyResult 后的最终任务状态（reviewing / done / blocked / failed）。 */
  readonly finalStatus: TaskStatus
  /** 执行器名称（dry-run-local / claude-sdk，供日志与 outcome 区分）。 */
  readonly executor: string
  /** worktree 绝对路径（合并阶段在 worktree 内 rebase + 读 result）。 */
  readonly worktreePath: string
  /** 刷新 context_pack 后的任务投影（合并 MergeTask 的 id/depends_on/result_file 来源）。 */
  readonly task: TaskFrontmatter
  /** 从 worktree 仓储读到的 .result.md（合并回写需要 global_update_requests）。 */
  readonly result: ResultFrontmatter
}

/* ============================================================ *
 * 用例实现
 * ============================================================ */

/**
 * 单任务执行用例（Readme.md §11 / 串行编排 SPEC §9 / §20.2）。
 *
 * 构造注入 ExecuteTaskPorts（CLI / Orchestrator wiring）；每次 execute 读取最新 frontmatter
 * 驱动一次完整执行阶段。用例不持有跨调用的任务状态副本——状态权威在 main 仓储 frontmatter，
 * 每步即时读、校验、写回（对齐 StateOrchestrator 的无副本约定）。
 *
 * 内部组合 StateOrchestrator（TASK-017）做状态流转、computeContextPack / refreshSourceFiles
 * （TASK-015）做 Context Pack、resolvePathScope / computeVerificationAllowlist（TASK-009）做
 * 权限边界——全部复用现有领域能力，不重复实现状态机/权限规则（任务 §8）。
 */
export class ExecuteTaskUseCase {
  constructor(private readonly ports: ExecuteTaskPorts) {}

  /**
   * 执行单个任务的「执行阶段」（不合并、不审查）。
   *
   * 阶段顺序（§9 数据流 / §11 验收）：
   *   1. 读任务（main 仓储）→ 状态须 ready。
   *   2. 依赖前置检查：全部 depends_on 须 done，否则拒绝运行。
   *   3. 刷新 context_pack.source_files（refreshSourceFiles）并回写 main 仓储 frontmatter。
   *   4. 组装权限边界：resolvePathScope 检测路径重叠（deny 优先，建 worktree 前拒绝启动）+
   *      computeVerificationAllowlist（layer 裁剪 + 任务级并集）。
   *   5. ready → running（StateOrchestrator.transition）。
   *   6. 创建 worktree（经 Port，独立工作区 + 分支 task/TASK-XXX）。
   *   7. R7 工作区准备（经 Port，恢复 node_modules）。
   *   8. 组装 §18 启动提示 → Executor 在 worktree 内执行、产出 .result.md。
   *   9. 读 .result.md（worktree 仓储——产物尚未合并入 main，§12 显式区分）。
   *  10. applyResult 状态映射（no_review 免审任务由本用例校验产物决定 done/blocked）。
   *
   * @returns ExecuteTaskOutcome 携带 finalStatus / worktreePath / 刷新后的 task / 读到的 result。
   */
  async execute(input: ExecuteTaskInput): Promise<ExecuteTaskOutcome> {
    const { taskRepo } = this.ports
    const taskId = input.taskId
    // 状态编排器复用同一 main 仓储：状态流转与执行阶段共享状态权威。
    const orchestrator = new StateOrchestrator(taskRepo)

    // 1. 读任务（main 仓储，frontmatter 权威）。
    const task = taskRepo.readTask(taskId)

    // 2. 状态前置：必须 ready 才能运行（draft 需先经 plan/task:create 置 ready）。
    if (task.status !== 'ready') {
      throw new Error(
        `任务 ${taskId} 当前状态为 ${task.status}，应为 ready 才能运行（先置 ready 后再执行）`,
      )
    }

    // 3. 依赖前置检查：全部依赖必须 done（任务 §8「依赖未完成 → 拒绝运行」）。
    const allTasks = readAllTasks(taskRepo)
    checkDependenciesDone(taskId, task.depends_on, allTasks)

    // 4. 刷新 context_pack.source_files（依赖完成后用其实际产物替换预填）并回写 main 仓储。
    const dependencyResults = readDependencyResults(taskRepo, task.depends_on)
    const refreshedSourceFiles = refreshSourceFiles(task, dependencyResults)
    const refreshedTask: TaskFrontmatter = {
      ...task,
      context_pack: { ...task.context_pack, source_files: refreshedSourceFiles },
    }
    taskRepo.writeTask(refreshedTask)
    const contextPack = computeContextPack(refreshedTask, { dependencyResults })

    // 5. 权限边界（路径重叠拒绝启动在 create worktree 之前，避免建了 worktree 再拒绝）。
    const boundary = buildPermissionBoundary(refreshedTask, input.testingCommands)

    // 6. ready → running（confirmed 不需要：ready→running 无 confirmed 闸门，§7）。
    orchestrator.transition(taskId, 'running', {
      no_review: task.no_review,
      confirmed: false,
    })

    // 7. worktree 创建（独立工作区 + 分支 task/TASK-XXX，§3.2）。
    const wtPath = this.ports.worktree.create(input.mainRef, taskId)

    // 8. R7：恢复 worktree 内 node_modules（经 Port，权限决定复用主工作区或 worktree 内重装）。
    this.ports.prepareWorktree(wtPath, task.permissions)

    // 9. 组装 §18 启动提示并在 worktree 内执行（Executor 产出 .result.md）。
    const resultFileRel = task.workflow_outputs.result_file
    const resultFileAbs = join(wtPath, resultFileRel)
    const startupPrompt = buildStartupPrompt({
      taskId,
      taskFile: taskFileFromResult(resultFileRel),
      resultFile: resultFileRel,
    })
    await this.ports.executor.execute({
      task_id: taskId,
      worktree_path: wtPath,
      result_file: resultFileAbs,
      context_pack: contextPack,
      permission_boundary: boundary,
      startup_prompt: startupPrompt,
    })

    // 10. 读 .result.md（worktree 仓储 —— 产物尚未合并入 main；§12 与 main 仓储显式区分）。
    const worktreeRepo = this.ports.openWorktreeRepo(wtPath)
    const result = worktreeRepo.readResult(taskId)

    // 11. 状态映射：把 result 映射为目标状态（no_review + completed + review 时校验产物三分，§7/§10）。
    // orchestratorVerified 镜像 StateOrchestrator.isResultAcceptable（验证结果无 failed）：
    // 免审任务由本用例校验产物，通过→done / 未通过→blocked。
    const orchestratorVerified = isProductAcceptable(result)
    orchestrator.applyResult(taskId, result, { orchestratorVerified })

    const finalStatus = taskRepo.readTask(taskId).status
    return {
      taskId,
      finalStatus,
      executor: this.ports.executor.name,
      worktreePath: wtPath,
      task: refreshedTask,
      result,
    }
  }
}

/* ============================================================ *
 * 迁入的领域辅助（原 task-run.ts 的可复用领域编排，CLI 不再持有）
 * ============================================================ */

/**
 * 组装 Executor 权限边界（§16）。
 *
 * resolvePathScope 检测 allowed/forbidden 重叠（deny 优先拒绝启动，不静默取并集）；
 * computeVerificationAllowlist 按 layer 裁剪项目级命令 + 任务级并集，产出验证 allowlist。
 */
function buildPermissionBoundary(
  task: TaskFrontmatter,
  testingCommands: readonly TestingCommand[],
) {
  const scope = resolvePathScope(task.allowed_paths, task.forbidden_paths)
  if (!scope.ok) {
    const overlapText = scope.overlaps
      .map((o) => `${o.allowed} ⋂ ${o.forbidden}`)
      .join('; ')
    throw new Error(
      `任务 ${task.id} 启动前权限检测失败：${scope.reason}（重叠: ${overlapText}）`,
    )
  }
  const verificationCommands = computeVerificationAllowlist({
    taskLayer: task.layer,
    testingCommands,
    taskVerification: task.verification,
  })
  return {
    allowed_paths: task.allowed_paths,
    forbidden_paths: task.forbidden_paths,
    permissions: task.permissions,
    verification_commands: verificationCommands,
  }
}

/** 读取全部任务 frontmatter，按 id 索引（供依赖状态检查）。 */
function readAllTasks(repo: TaskDocRepositoryPort): Map<TaskId, TaskFrontmatter> {
  const map = new Map<TaskId, TaskFrontmatter>()
  for (const id of repo.listTasks()) {
    map.set(id, repo.readTask(id))
  }
  return map
}

/**
 * 检查全部依赖是否 done（任务 §8：依赖未完成 → 拒绝运行并提示）。
 *
 * 依赖不在任务集合内（无法确认完成）或状态非 done 均视为未完成，抛错不静默。
 */
function checkDependenciesDone(
  taskId: TaskId,
  dependsOn: readonly TaskId[],
  allTasks: Map<TaskId, TaskFrontmatter>,
): void {
  if (dependsOn.length === 0) return
  const pending: string[] = []
  for (const dep of dependsOn) {
    const depTask = allTasks.get(dep)
    if (depTask === undefined) {
      pending.push(`${dep}（不在任务集合内，无法确认完成）`)
    } else if (depTask.status !== 'done') {
      pending.push(`${dep}（当前 ${depTask.status}）`)
    }
  }
  if (pending.length > 0) {
    throw new Error(
      `任务 ${taskId} 的前置依赖未全部完成，拒绝运行（§8）：${pending.join('; ')}`,
    )
  }
}

/**
 * 读取各依赖 .result.md 的产物清单（modified_files ∪ created_files）。
 *
 * 调用前依赖已确认 done（checkDependenciesDone）；done 依赖无 .result.md（异常但非致命）
 * 按空产物计入，使 refreshSourceFiles 仍能刷新（all-or-nothing：全部依赖在 map 内即刷新）。
 */
function readDependencyResults(
  repo: TaskDocRepositoryPort,
  dependsOn: readonly TaskId[],
): ReadonlyMap<TaskId, DependencyResultSummary> {
  const map = new Map<TaskId, DependencyResultSummary>()
  for (const dep of dependsOn) {
    let modifiedFiles: string[] = []
    let createdFiles: string[] = []
    try {
      const r = repo.readResult(dep)
      modifiedFiles = [...r.modified_files]
      createdFiles = [...r.created_files]
    } catch (err) {
      // 依赖 done 但 .result.md 缺失：按空产物计入；其余错误（损坏）冒泡。
      if (!isDocMissing(err)) throw err
    }
    map.set(dep, { task_id: dep, modified_files: modifiedFiles, created_files: createdFiles })
  }
  return map
}

/**
 * no_review 任务的「产物齐全」校验（§7 / §15）。
 *
 * 镜像 StateOrchestrator.isResultAcceptable（私有）：.result.md 可读（readResult 不抛即结构合法）+
 * 验证结果无失败项（verification 无 result === 'failed'）。通过 → 免审直 done，未通过 → blocked。
 */
function isProductAcceptable(result: ResultFrontmatter): boolean {
  return result.verification.every((v) => v.result !== 'failed')
}

/** 从 workflow_outputs.result_file 派生任务文件路径（去 .result.md 加 .md，§9 共用 slug）。 */
function taskFileFromResult(resultFile: string): string {
  const suffix = '.result.md'
  if (!resultFile.endsWith(suffix)) return resultFile
  return resultFile.slice(0, resultFile.length - suffix.length) + '.md'
}

/** 判定错误是否为「文档不存在」（TaskDocRepository 抛错的稳定前缀，DEC-008）。 */
function isDocMissing(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('文档不存在')
}
