/**
 * 单任务审查 Application 用例（Readme.md §5.3 / §15 / 串行编排 SPEC §9 / §20.2）。
 *
 * 把原本堆在 CLI `task:review`（task-review.ts）中的审查编排抽取为 application 层用例，
 * 为后续串行 Orchestrator（TASK-044）提供稳定、可测试的单任务审查入口：
 *   `reviewing → Reviewer → ReviewDoc → done/rejected/blocked`
 *
 * 职责边界（任务 §2 / §8 / §9）：
 *   - 负责「审查阶段」全链：读任务（main 仓储，须 reviewing）→ 读 .result.md（worktree 仓储）→
 *     产出审查结论（no_review → Orchestrator 生成 skipped 占位 / 否则调 Reviewer）→
 *     写 .review.md（main 仓储——审查结论与执行事实分离，§5.3）→ applyReview 状态映射。
 *   - **不负责合并回收**：done 之后的合并由独立的 FinalizeTaskUseCase 承接（§8「Review 和
 *     Finalize 是两个职责独立的用例」）。本用例在状态映射（done / rejected / blocked）后
 *     返回结构化结果（含 task / result / worktreePath），使调用方在 done 路径能直接喂给
 *     FinalizeTaskUseCase，无需重新读取。
 *
 * 依赖方向（ARCHITECTURE.md §3 / §4 / 任务 §8）：`cli → application ← infrastructure`。
 *   - 本用例只依赖 core 领域原语 + application Ports（TaskDocRepositoryPort / TaskReviewerPort），
 *     零 infrastructure 实现类导入。
 *   - 「在 worktree 路径打开文档仓储读 .result.md」作为注入能力（openWorktreeRepo）由 CLI
 *     composition root wiring——用例不感知 worktree 内目录结构，避免隐式路由（§12 风险点）。
 *   - main 文档仓储（任务状态权威 / .review.md 落点）与 worktree 文档仓储（.result.md 所在）
 *     在 Ports 层显式区分：审查结论写回 main 仓储，.result.md 从 worktree 仓储读取；applyReview
 *     的 skipped 分支内部读 .result.md 经路由适配器路由到 worktree 仓储（§12 显式区分）。
 *
 * 权威来源：根目录 Readme.md §5.3（Reviewer）/ §15（审查清单与映射）/ §7（状态机 reviewing 出边）。
 */
import type {
  ResultFrontmatter,
  ReviewFrontmatter,
  ReviewResult,
  TaskFrontmatter,
  TaskId,
  TaskStatus,
} from '../../core/index.js'
import type { TaskDocRepositoryPort } from '../ports.js'
import type { TaskReviewerPort } from './ports.js'
// 直接从具体 application 模块导入（不经 ../index.js），避免 application/index ↔ execution 的循环依赖。
import { StateOrchestrator } from '../state-orchestrator.js'

/* ============================================================ *
 * 用例依赖（Ports）与输入输出
 * ============================================================ */

/**
 * ReviewTaskUseCase 的注入依赖（任务 §2「经 Ports 注入」/ §8「main/worktree 仓储显式 Port 组合」）。
 *
 *   - taskRepo：main 仓库文档仓储，任务状态权威——读任务 frontmatter（须 reviewing）、
 *     写回 .review.md（审查结论与执行事实分离，§5.3）、applyReview 状态流转。
 *   - reviewer：审查器 Port，对 .result.md 产出审查结论（契约见 execution/ports.ts）。
 *     no_review 任务不调 Reviewer（Orchestrator 生成 skipped 占位）。
 *   - openWorktreeRepo：在 worktree 路径下打开文档仓储，专用于读 Executor 产出的 .result.md
 *     （产物尚未合并入 main）。与 taskRepo 显式区分，避免用路径判断隐式路由（§12 风险点）。
 */
export interface ReviewTaskPorts {
  /** main 仓库文档仓储：任务状态权威（读写 frontmatter + 写 .review.md）。 */
  readonly taskRepo: TaskDocRepositoryPort
  /** 审查器 Port：对 .result.md 产出审查结论。 */
  readonly reviewer: TaskReviewerPort
  /** 在 worktree 路径下打开文档仓储，读 Executor 产出的 .result.md（§12 主/worktree 显式区分）。 */
  readonly openWorktreeRepo: (wtPath: string) => TaskDocRepositoryPort
}

/** ReviewTaskUseCase.review 的调用参数。 */
export interface ReviewTaskInput {
  /** 要审查的任务 id。 */
  readonly taskId: TaskId
  /** worktree 绝对路径（.result.md 产物所在，尚未合并入 main）。 */
  readonly worktreePath: string
}

/**
 * ReviewTaskUseCase 的结构化阶段结果（任务 §9「用例返回结构化阶段结果」）。
 *
 * 携带合并阶段（FinalizeTaskUseCase）所需的一切：任务投影、读到的 result、worktree 路径——
 * 使 CLI / Orchestrator 在 done 路径能直接喂给 FinalizeTaskUseCase，无需重新读取或二次推导。
 */
export interface ReviewTaskOutcome {
  /** 当前任务 id。 */
  readonly taskId: TaskId
  /** applyReview 后的最终任务状态（done / rejected / blocked）。 */
  readonly finalStatus: TaskStatus
  /** 审查结论（approved / rejected / needs-human-confirmation / skipped）。 */
  readonly reviewResult: ReviewResult
  /** 审查者标识（注入的 reviewer 名 / orchestrator）。 */
  readonly reviewer: string
  /** worktree 绝对路径（rejected / blocked 时保留供人工处理；done 时合并阶段在 worktree 内 rebase）。 */
  readonly worktreePath: string
  /** 任务投影（合并阶段 MergeTask 的 id / depends_on / result_file 来源）。 */
  readonly task: TaskFrontmatter
  /** 从 worktree 仓储读到的 .result.md（合并回写需要 global_update_requests）。 */
  readonly result: ResultFrontmatter
}

/* ============================================================ *
 * 用例实现
 * ============================================================ */

/** no_review 占位审查的审查者标识（§15「由 Orchestrator 生成」）。 */
const ORCHESTRATOR_REVIEWER = 'orchestrator'

/**
 * 单任务审查用例（Readme.md §5.3 / §15 / 串行编排 SPEC §20.2）。
 *
 * 构造注入 ReviewTaskPorts（CLI / Orchestrator wiring）；每次 review 读取最新 frontmatter
 * 驱动一次完整审查阶段。用例不持有跨调用的任务状态副本——状态权威在 main 仓储 frontmatter，
 * 每步即时读、校验、写回（对齐 StateOrchestrator 的无副本约定）。
 *
 * 内部组合 StateOrchestrator.applyReview（TASK-017）做状态映射——复用现有领域能力，不重复
 * 实现状态机 / 映射规则（任务 §8）。main / worktree 仓储经路由适配器组合，使 applyReview 的
 * skipped 分支读 .result.md 路由到 worktree 仓储（§12 显式区分）。
 */
export class ReviewTaskUseCase {
  constructor(private readonly ports: ReviewTaskPorts) {}

  /**
   * 审查单个任务（不合并）。
   *
   * 阶段顺序（§5.3 / §15 / 任务 §9）：
   *   1. 读任务（main 仓储）→ 状态须 reviewing（applyReview 四映射的合法起始态，§7）。
   *   2. 读 .result.md（worktree 仓储——供 reviewer 审查 + applyReview skipped 分支校验）。
   *   3. 产出审查结论：no_review → Orchestrator 生成 skipped 占位（§15）；否则调 Reviewer。
   *   4. 写 .review.md（main 仓储——审查结论属 Orchestrator/Reviewer 产物，与 .result.md 分离，§5.3）。
   *   5. applyReview 映射状态（approved→done / rejected→rejected / needs-human→blocked /
   *      skipped→产物校验三分），经路由适配器：task 状态权威在 main、.result.md 在 worktree。
   *
   * @returns ReviewTaskOutcome 携带 finalStatus / reviewResult / task / result / worktreePath。
   */
  async review(input: ReviewTaskInput): Promise<ReviewTaskOutcome> {
    const { taskRepo, reviewer } = this.ports
    const taskId = input.taskId

    // 1. 读任务（main 仓储，frontmatter 权威）。
    const task = taskRepo.readTask(taskId)

    // 2. 状态前置：必须 reviewing（applyReview 四映射的合法起始态，§7 状态机 reviewing 出边）。
    if (task.status !== 'reviewing') {
      throw new Error(
        `任务 ${taskId} 当前状态为 ${task.status}，应为 reviewing 才能审查` +
          '（先经 caw task:run 进入 reviewing 后再审查）',
      )
    }

    // 3. 读 .result.md（worktree 仓储——产物尚未合并入 main；§12 显式区分）。
    const worktreeRepo = this.ports.openWorktreeRepo(input.worktreePath)
    const result = worktreeRepo.readResult(taskId)

    // 4. 产出审查结论：no_review → Orchestrator 生成 skipped 占位（§15）；否则调 Reviewer。
    const review = task.no_review
      ? buildReviewFrontmatter(taskId, ORCHESTRATOR_REVIEWER, {
          review_result: 'skipped',
          required_changes: [],
          findings: [],
        })
      : buildReviewFrontmatter(taskId, reviewer.name, await reviewer.review({
          task_id: taskId,
          result,
          worktree_path: input.worktreePath,
          result_file: task.workflow_outputs.result_file,
        }))

    // 5. 写 .review.md（main 仓储——审查结论与 .result.md 分离，§5.3）。
    taskRepo.writeReview(review)

    // 6. applyReview 映射状态（路由适配器：task 状态权威在 main、.result.md 在 worktree）。
    //    skipped 分支内部 readResult 经适配器路由到 worktree（.result.md 尚未合并入 main）。
    const orchestrator = new StateOrchestrator(reviewOrchestratorRepo(taskRepo, worktreeRepo))
    orchestrator.applyReview(taskId, review)

    const finalStatus = taskRepo.readTask(taskId).status
    return {
      taskId,
      finalStatus,
      reviewResult: review.review_result,
      reviewer: review.reviewer,
      worktreePath: input.worktreePath,
      task,
      result,
    }
  }
}

/* ============================================================ *
 * 迁入的领域辅助（原 task-review.ts 的可复用审查编排，CLI 不再持有）
 * ============================================================ */

/**
 * task:review 专用的 Orchestrator 仓储适配器（§12 风险点）。
 *
 * applyReview 的 skipped 分支内部调 readResult 读 .result.md，而 .result.md 在 worktree
 * （尚未合并入 main）；同时 task 状态权威在 main。单一 TaskDocRepository（单 tasksDir）
 * 无法兼顾两者（ISS-009 路由问题的细化），故组合双仓储：task / review 操作路由到 main
 * （状态权威 + .review.md 落点），result 操作路由到 worktree（.result.md 所在）。
 *
 * 结构类型满足 TaskDocRepositoryPort，StateOrchestrator 无感知（ARCHITECTURE.md §4）。
 */
function reviewOrchestratorRepo(
  main: TaskDocRepositoryPort,
  worktree: TaskDocRepositoryPort,
): TaskDocRepositoryPort {
  return {
    readTask: (id) => main.readTask(id),
    writeTask: (task, body) => main.writeTask(task, body),
    readResult: (id) => worktree.readResult(id),
    writeResult: (result, body) => worktree.writeResult(result, body),
    readReview: (id) => main.readReview(id),
    writeReview: (review, body) => main.writeReview(review, body),
    listTasks: () => main.listTasks(),
  }
}

/**
 * 把审查结论组装为合法 ReviewFrontmatter（补全 task_id / reviewer / reviewed_at）。
 *
 * reviewed_at 用 ISO8601 UTC（§8 / §15，z.string().datetime() 接受带 Z 的时间戳）。
 */
function buildReviewFrontmatter(
  taskId: TaskId,
  reviewerName: string,
  partial: {
    readonly review_result: ReviewResult
    readonly required_changes: readonly string[]
    readonly findings: readonly string[]
  },
): ReviewFrontmatter {
  return {
    task_id: taskId,
    review_result: partial.review_result,
    reviewer: reviewerName,
    reviewed_at: new Date().toISOString(),
    required_changes: [...partial.required_changes],
    findings: [...partial.findings],
  }
}
