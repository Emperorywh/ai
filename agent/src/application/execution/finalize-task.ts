/**
 * 单任务共享完成 Application 用例（Readme.md §3.2 / §8 / 串行编排 SPEC §9 / §20.4）。
 *
 * 把原本在 CLI `task:run` 与 `task:review` 中**重复实现**的 done 路径合并回收抽取为
 * application 层共享用例，供两处 CLI command 与后续串行 Orchestrator（TASK-044）复用——
 * 不得复制第三套合并实现（SPEC §20.4「复用与重构」）。
 *
 * 职责边界（任务 §2 / §8 / §9）：
 *   - 负责 done 之后的「合并回收」全链：rebase + 回填 + fast-forward（TASK-019）→
 *     全局文档 section 回写（TASK-020）→ 主工作区结果文件同步。
 *   - 合并冲突：done → blocked（经 StateOrchestrator，confirmed=true）+ 把冲突登记进
 *     docs/ISSUES.md（§3.2 / §8 不静默）。**不做冲突仲裁**，只返回结构化冲突清单。
 *   - **不负责执行 / 审查 / 状态映射**：调用方（CLI / Orchestrator）在执行用例
 *     （ExecuteTaskUseCase）或审查用例（ReviewTaskUseCase）产出 done 后才调用本用例。
 *
 * 依赖方向（ARCHITECTURE.md §3 / §4 / 任务 §8）：`cli → application ← infrastructure`。
 *   - 本用例只依赖 core 领域原语 + application 合并编排（rebase-ff / section-writeback）+
 *     application Ports（TaskDocRepositoryPort / GitMergePort / GlobalDocRepositoryPort），
 *     零 infrastructure 实现类导入。
 *   - 「在 worktree 路径打开文档仓储读 / 回填 .result.md」「合并后同步主工作区结果文件」
 *     作为注入能力（openWorktreeRepo / syncMainFile）由 CLI composition root wiring——
 *     用例不感知 worktree 内目录结构与 git checkout 细节，避免隐式路由（任务 §12 风险点）。
 *   - main 文档仓储（任务状态权威）与 worktree 文档仓储（合并读 .result.md）在 Ports 层
 *     显式区分：冲突 done→blocked 写回 main 仓储，合并 rebaseAndFastForward 的 docs port
 *     路由到 worktree 仓储（.result.md 尚未合并入 main，§12 显式区分）。
 *
 * 权威来源：根目录 Readme.md §3.2（worktree 合并策略）/ §8（不静默）/ §17（失败恢复）。
 */
import type {
  ResultFrontmatter,
  TaskFrontmatter,
  TaskId,
} from '../../core/index.js'
import type {
  GitMergePort,
  GlobalDocRepositoryPort,
  TaskDocRepositoryPort,
} from '../ports.js'
// 直接从具体 application 模块导入（不经 ../index.js），避免 application/index ↔ execution 的循环依赖。
import { StateOrchestrator } from '../state-orchestrator.js'
import { rebaseAndFastForward, type MergePorts, type MergeTask } from '../merge/rebase-ff.js'
import {
  writebackGlobalDocs,
  type IdAllocator,
  type WritebackRequest,
} from '../merge/section-writeback.js'

/* ============================================================ *
 * 用例依赖（Ports）与输入输出
 * ============================================================ */

/**
 * FinalizeTaskUseCase 的注入依赖（任务 §2「经 Ports 注入」/ §8「main/worktree 仓储显式 Port 组合」）。
 *
 * 各 Port / 回调由 CLI composition root（或串行 Orchestrator）wiring 具体实现后注入：
 *   - taskRepo：main 仓库文档仓储，任务状态权威——冲突时 done→blocked 经此写回。
 *   - gitMerge：合并用 git 原语 Port（rebase / ff / 冲突探测 / 清理 / commit 采集）。
 *   - globalDocRepo：全局文档读写 Port（section 回写 + 冲突 ISSUES 登记）。
 *   - idAllocator：DEC-XXX / ISS-XXX id 分配器（冲突 issue 分配 ISS-XXX 用）。
 *   - openWorktreeRepo：在 worktree 路径下打开文档仓储，专用于合并 rebaseAndFastForward
 *     读 / 回填 .result.md（产物尚未合并入 main）。与 taskRepo 显式区分（§12 风险点）。
 *   - syncMainFile：合并成功后把已进 main 历史的结果文件同步到主工作区（fastForwardMain
 *     用 update-ref 移动 ref、不检出工作区；此回调绑定 projectRoot + mainRef 闭包执行
 *     git checkout）。签名为注入回调（与 execute-task 的 prepareWorktree 同构），使本用例
 *     不依赖具体 git I/O，可在 fake Ports 下纯内存测试。
 */
export interface FinalizeTaskPorts {
  /** main 仓库文档仓储：任务状态权威（冲突 done→blocked 写回）。 */
  readonly taskRepo: TaskDocRepositoryPort
  /** 合并用 git 原语 Port。 */
  readonly gitMerge: GitMergePort
  /** 全局文档读写 Port（section 回写 + 冲突 ISSUES 登记）。 */
  readonly globalDocRepo: GlobalDocRepositoryPort
  /** DEC-XXX / ISS-XXX id 分配器。 */
  readonly idAllocator: IdAllocator
  /** 在 worktree 路径下打开文档仓储，供合并 rebaseAndFastForward 读 / 回填 .result.md（§12 显式区分）。 */
  readonly openWorktreeRepo: (wtPath: string) => TaskDocRepositoryPort
  /** 合并成功后同步主工作区结果文件（infrastructure 回调，CLI 闭包绑定 git checkout）。 */
  readonly syncMainFile: (resultFileRel: string) => void
}

/**
 * FinalizeTaskUseCase.finalize 的调用参数。
 *
 * 携带合并阶段所需的一切——worktree 路径、任务投影、读到的 result——由执行用例
 * （ExecuteTaskOutcome）或审查用例（ReviewTaskOutcome）在 done 路径直接传入，无需重新读取。
 */
export interface FinalizeTaskInput {
  /** 当前任务 id。 */
  readonly taskId: TaskId
  /** 主分支短名（rebase / ff 基线）。 */
  readonly mainRef: string
  /** worktree 绝对路径（合并在 worktree 内 rebase）。 */
  readonly worktreePath: string
  /** 任务投影（合并 MergeTask 的 id / depends_on / result_file 来源；no_review 供冲突转移上下文）。 */
  readonly task: TaskFrontmatter
  /** 从 worktree 仓储读到的 .result.md（合并回写需要 global_update_requests）。 */
  readonly result: ResultFrontmatter
}

/** FinalizeTaskUseCase 的结构化结果：合并是否成功 + 冲突清单。 */
export interface FinalizeTaskOutcome {
  /** 当前任务 id。 */
  readonly taskId: TaskId
  /** 是否成功合并回收（true=已 ff 进 main；false=合并冲突，已置 blocked + 落 ISSUES）。 */
  readonly merged: boolean
  /** 合并冲突文件清单（仅 merged=false 时非空）。 */
  readonly conflicts: readonly string[]
}

/* ============================================================ *
 * 用例实现
 * ============================================================ */

/**
 * 单任务共享完成用例（Readme.md §3.2 / 串行编排 SPEC §20.4）。
 *
 * 构造注入 FinalizeTaskPorts（CLI / Orchestrator wiring）；每次 finalize 读取传入的结构化
 * 输入驱动一次完整合并回收。用例不持有跨调用的任务状态副本——状态权威在 main 仓储 frontmatter。
 *
 * 内部组合 rebaseAndFastForward（TASK-019）+ writebackGlobalDocs（TASK-020）+ StateOrchestrator
 * （TASK-017，冲突 done→blocked）——全部复用现有领域能力，不重复实现合并 / 回写 / 状态机规则
 * （SPEC §20.4「不得复制现有命令逻辑形成第三套实现」，任务 §8）。
 */
export class FinalizeTaskUseCase {
  constructor(private readonly ports: FinalizeTaskPorts) {}

  /**
   * 执行 done 路径的合并回收（rebase + 回填 + ff + 全局回写 + 主工作区同步；
   * 冲突 → blocked + ISSUES）。
   *
   * 阶段顺序（§3.2 / 任务 §9「仅 done 进入 Finalize」）：
   *   1. 经 openWorktreeRepo 打开 worktree 仓储，作为 rebaseAndFastForward 的 docs port
   *      （合并读 / 回填 .result.md 在 worktree 内，ISS-009 路由）。
   *   2. rebaseAndFastForward（单任务）：rebase 到最新 main → 探测冲突 → 无冲突则采集
   *      commit、回填 execution_commits、提交 audit commit、fast-forward 回收 main。
   *   3. 合并成功 → writebackGlobalDocs（串行回写 global_update_requests）+ syncMainFile
   *      （主工作区结果文件同步）。
   *   4. 合并冲突 → done→blocked（StateOrchestrator confirmed=true）+ appendMergeConflictIssue
   *      （登记 ISS-XXX 进 docs/ISSUES.md，§3.2 / §8 不静默）。
   *
   * @returns FinalizeTaskOutcome 携带 merged 与 conflicts 清单。
   */
  finalize(input: FinalizeTaskInput): FinalizeTaskOutcome {
    const taskId = input.taskId
    // 合并的 docs port 路由到 worktree 仓储（.result.md 尚未合并入 main，ISS-009）。
    const docs: MergePorts['docs'] = this.ports.openWorktreeRepo(input.worktreePath)
    const ports: MergePorts = { git: this.ports.gitMerge, docs }
    const mergeTask: MergeTask = {
      id: input.task.id,
      depends_on: input.task.depends_on,
      workflow_outputs: { result_file: input.task.workflow_outputs.result_file },
    }
    const outcome = rebaseAndFastForward(ports, [mergeTask], { mainRef: input.mainRef })
    const own = outcome.results.find((r) => r.taskId === taskId)
    if (own === undefined) {
      // 单任务合并必产出本任务结果；到此处属异常，不静默。
      throw new Error(`合并未产出 ${taskId} 的结果`)
    }

    if (own.ok) {
      // 合并成功 → 全局文档 section 回写（§3.2 串行回写 global_update_requests）。
      const writebackRequest: WritebackRequest = {
        task_id: taskId,
        updates: input.result.global_update_requests,
      }
      writebackGlobalDocs(this.ports.globalDocRepo, [writebackRequest], {
        idAllocator: this.ports.idAllocator,
      })
      // fastForwardMain 用 update-ref 移动 ref、不检出工作区；把已进 main 历史的结果文件
      // 同步到主工作区（仅该文件，不动任务 status 工作区写回）。
      this.ports.syncMainFile(input.task.workflow_outputs.result_file)
      return { taskId, merged: true, conflicts: [] }
    }

    // 合并冲突：done → blocked（Orchestrator confirmed）+ 落 ISSUES（§3.2/§8 不静默）。
    const orchestrator = new StateOrchestrator(this.ports.taskRepo)
    orchestrator.transition(taskId, 'blocked', {
      no_review: input.task.no_review,
      confirmed: true,
    })
    appendMergeConflictIssue(
      this.ports.globalDocRepo,
      this.ports.idAllocator,
      taskId,
      own.conflicts,
    )
    return { taskId, merged: false, conflicts: [...own.conflicts] }
  }
}

/* ============================================================ *
 * 迁入的领域辅助（原两处 CLI 的冲突登记，CLI 不再持有）
 * ============================================================ */

/**
 * 把合并冲突登记进 docs/ISSUES.md（§3.2 / 任务 §8 不静默）。
 *
 * 经 idAllocator 分配 ISS-XXX（既有非空 id ∪ 本批次去重）后 appendIssue 写回。
 * 冲突清单（unmerged 文件）记入 recommended_action 供人工定位。
 *
 * 命令中立：finalizer 供 task:run / task:review / Orchestrator 三处共用，recommended_action
 * 提示两种重跑入口（不绑定具体命令），保持单一业务入口（SPEC §20.4 / 任务 §11）。
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
    recommended_action:
      `解决 rebase 合并冲突后重跑该任务（caw task:run / task:review ${taskId}）；` +
      `冲突文件: ${conflicts.join(', ')}`,
  })
  globalRepo.writeGlobalDoc('issues', updated)
}

/** 从既有条目数组收集非空 id 集合（id 分配去重基线，镜像 section-writeback.collectExistingIds）。 */
function collectExistingIds(entries: ReadonlyArray<{ id: string }>): Set<string> {
  const set = new Set<string>()
  for (const e of entries) {
    if (e.id !== '') set.add(e.id)
  }
  return set
}
