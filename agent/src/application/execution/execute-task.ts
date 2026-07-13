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
  Issue,
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
import type {
  TaskExecutorPort,
  VerificationRunnerPort,
  WorkspaceInspectionPort,
} from './ports.js'
import { buildStartupPrompt } from './ports.js'
// TASK-040：路径审计纯函数 + 系统验证用例（直接从具体模块导入，避免循环）。
import { auditPaths, type PathAuditOutcome, type PathViolation } from './path-audit.js'
import { VerifyTaskUseCase, type VerifyTaskOutcome } from './verify-task.js'

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
  /**
   * 工作区变更检查 Port（TASK-040，可选）：注入后 Executor 返回即做路径越界审计（FR-039）。
   * 未注入（undefined）→ 跳过路径审计，保持与 TASK-037 行为一致（向后兼容既有测试与 DryRun CLI）。
   */
  readonly workspaceInspector?: WorkspaceInspectionPort
  /**
   * 系统验证执行 Port（TASK-040，可选）：注入后 Executor 返回即独立执行验证 allowlist 覆盖模型自报（FR-011）。
   * 未注入（undefined）→ 跳过系统验证，状态映射回退到模型自报 verification（向后兼容）。
   * 串行 Orchestrator（TASK-044）与显式启用真实验证的 CLI 路径注入真实 Runner。
   */
  readonly verificationRunner?: VerificationRunnerPort
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
  /** 从 worktree 仓储读到的 .result.md（合并回写需要 global_update_requests；TASK-040 起含系统验证覆盖 + 越界 / 验证失败 issue 提议）。 */
  readonly result: ResultFrontmatter
  /**
   * 路径越界审计结果（TASK-040，workspaceInspector 注入时定义；未注入为 undefined）。
   * ok=false 时 finalStatus 必为 blocked（needs-human 门禁，FR-039/AC-011）。
   */
  readonly pathAudit?: PathAuditOutcome
  /**
   * 系统验证结果（TASK-040，verificationRunner 注入时定义；未注入为 undefined）。
   * status='blocked' 时 no_review 任务 finalStatus=blocked，普通任务仍 reviewing 交 Reviewer。
   */
  readonly systemVerification?: VerifyTaskOutcome
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
   *  10. （TASK-040，可选注入）路径越界审计 + 系统验证，结果写回 worktree .result.md。
   *  11. 状态映射：路径越界→blocked（needs-human）；否则按系统验证（若注入）/ 模型自报
   *      映射（reviewing / done / blocked / failed，no_review 免审任务由验证门禁决定 done/blocked）。
   *
   * @returns ExecuteTaskOutcome 携带 finalStatus / worktreePath / 刷新后的 task / 读到的 result / pathAudit / systemVerification。
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

    // 11. 路径审计 + 系统验证（TASK-040 / SPEC FR-039 / FR-011）。
    //     两阶段均经可选 Port 注入：Executor 返回后先做路径越界审计（FR-039），再独立执行
    //     验证 allowlist 覆盖模型自报（FR-011）。二者结果写回 worktree .result.md（§9 数据流）。
    //     未注入对应 Port → 跳过该阶段，保持与 TASK-037 行为一致（向后兼容既有测试与 DryRun CLI）。
    const audited = await this.auditAndVerify(
      refreshedTask,
      result,
      wtPath,
      input.testingCommands,
    )

    // 12. 状态映射（§9 数据流）。
    if (audited.pathAudit !== undefined && !audited.pathAudit.ok) {
      // 路径越界 → running→blocked（needs-human 门禁，不交 Reviewer，FR-039 / AC-011）。
      // 直接 transition，不依赖 mapResultToStatus 的 blocked 分支（语义明确）。
      orchestrator.transition(taskId, 'blocked', {
        no_review: refreshedTask.no_review,
        confirmed: false,
      })
    } else {
      // 否则按系统验证（若注入）或模型自报（未注入）决定 orchestratorVerified：
      //   - 普通任务 completed+review → reviewing（验证失败仍交 Reviewer，§9）。
      //   - no_review + 验证 passed → done；no_review + 验证失败 → blocked（§7 三分）。
      const orchestratorVerified =
        audited.systemVerification !== undefined
          ? audited.systemVerification.status === 'passed'
          : isProductAcceptable(audited.result)
      orchestrator.applyResult(taskId, audited.result, { orchestratorVerified })
    }

    const finalStatus = taskRepo.readTask(taskId).status
    return {
      taskId,
      finalStatus,
      executor: this.ports.executor.name,
      worktreePath: wtPath,
      task: refreshedTask,
      result: audited.result,
      pathAudit: audited.pathAudit,
      systemVerification: audited.systemVerification,
    }
  }

  /* ============================================================ *
   * TASK-040：路径审计 + 系统验证（可选注入，向后兼容）
   * ============================================================ */

  /**
   * 路径审计 + 系统验证（TASK-040 / SPEC FR-039 / FR-011）。
   *
   * 两个阶段均经可选 Port 注入：workspaceInspector / verificationRunner 任一缺失则对应阶段
   * 跳过。返回写回 worktree 的最终 result（含系统验证覆盖的 verification + 路径越界 / 验证
   * 失败 issue 提议）与两阶段结构化结果，供 execute 做状态映射与 outcome 携带。
   *
   * 阶段顺序（§9 数据流「先枚举实际变更，再运行系统验证」）：
   *   A. 路径越界审计：枚举变更（排除默认允许的 result_file）→ auditPaths。
   *      越界 → 系统覆盖 result 为 blocked + needs-human + 越界 issue 提议（FR-039 / AC-011）。
   *   B. 系统验证：VerifyTaskUseCase 独立执行 allowlist → 系统记录覆盖模型自报（FR-011.5）。
   *      失败 issue 提议并入 result（供后续回写 ISSUES）。
   *   C. 有审计 / 验证覆盖时写回 worktree .result.md（使 Reviewer / 人工读到真实结论）。
   */
  private async auditAndVerify(
    task: TaskFrontmatter,
    result: ResultFrontmatter,
    wtPath: string,
    testingCommands: readonly TestingCommand[],
  ): Promise<{
    readonly result: ResultFrontmatter
    readonly pathAudit: PathAuditOutcome | undefined
    readonly systemVerification: VerifyTaskOutcome | undefined
  }> {
    let augmented: ResultFrontmatter = result
    let pathAudit: PathAuditOutcome | undefined
    let systemVerification: VerifyTaskOutcome | undefined

    // 阶段 A：路径越界审计（FR-039「执行后用 Git diff 再校验一次」）。
    if (this.ports.workspaceInspector !== undefined) {
      const changedRaw = this.ports.workspaceInspector.listChangedFiles(wtPath)
      // result_file 为 workflow_outputs 默认允许写入（§3.2，不计入 allowed_paths），审计前排除——
      // 否则 DryRun / Executor 写 .result.md 会被误判越界。
      const resultFileRel = task.workflow_outputs.result_file
      const changedForAudit = changedRaw.filter(
        (f) => normalizeForCompare(f) !== normalizeForCompare(resultFileRel),
      )
      pathAudit = auditPaths({
        changedFiles: changedForAudit,
        allowedPaths: task.allowed_paths,
        forbiddenPaths: task.forbidden_paths,
      })
      if (!pathAudit.ok) {
        const issue = buildPathViolationIssue(task.id, pathAudit.violations)
        augmented = {
          ...augmented,
          execution_status: 'blocked',
          next_action: 'needs-human',
          global_update_requests: {
            ...augmented.global_update_requests,
            issues: [...augmented.global_update_requests.issues, issue],
          },
        }
      }
    }

    // 阶段 B：系统验证（FR-011「Executor 完成后独立执行 allowlist」），系统记录覆盖模型自报。
    if (this.ports.verificationRunner !== undefined) {
      const verifyUseCase = new VerifyTaskUseCase({ runner: this.ports.verificationRunner })
      systemVerification = await verifyUseCase.verify({
        taskId: task.id,
        worktreePath: wtPath,
        taskLayer: task.layer,
        taskPermissions: task.permissions,
        taskVerification: task.verification,
        testingCommands,
        modelVerification: augmented.verification,
      })
      augmented = {
        ...augmented,
        verification: [...systemVerification.verification],
        global_update_requests: {
          ...augmented.global_update_requests,
          issues: [
            ...augmented.global_update_requests.issues,
            ...systemVerification.proposedIssues,
          ],
        },
      }
    }

    // 阶段 C：有审计 / 验证覆盖时写回 worktree .result.md。
    if (pathAudit !== undefined || systemVerification !== undefined) {
      this.ports.openWorktreeRepo(wtPath).writeResult(augmented)
    }

    return { result: augmented, pathAudit, systemVerification }
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

/* ============================================================ *
 * TASK-040：路径审计辅助
 * ============================================================ */

/**
 * 路径规范化用于 result_file 排除比较（与 path-audit.normalizePath 同源）。
 *
 * Git status 输出正斜杠相对路径，result_file（frontmatter）也是正斜杠；规范化仅统一
 * Windows 反斜杠与尾部斜杠差异，使二者可按相同形态比较以排除默认允许的 result_file。
 */
function normalizeForCompare(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
}

/**
 * 构造「工作区路径越界」ISSUES 提议项（FR-039 / AC-011）。
 *
 * severity='high'：越界改动禁止合并，需人工修正改动落回 allowed_paths 内。id 留空，
 * 由 Orchestrator / Finalize 回写分配 ISS-XXX（blocked 时 .result.md 携带，待人工处理）。
 */
function buildPathViolationIssue(taskId: TaskId, violations: readonly PathViolation[]): Issue {
  const detail = violations
    .map((v) => `${v.path}(${v.kind}${v.matchedPattern ? `=${v.matchedPattern}` : ''})`)
    .join('; ')
  return {
    id: '',
    title: '工作区路径越界，禁止合并',
    status: 'open',
    severity: 'high',
    scope: 'verification',
    created_from_task: taskId,
    owner: '',
    recommended_action: `修正越界改动使其落在 allowed_paths 内且不命中 forbidden_paths：${detail}`,
  }
}
