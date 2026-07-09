/**
 * Application 状态流转编排器（Readme.md §5.1 / §7 / §10 / §15）。
 *
 * 把 core 层的状态机（TASK-007 validateTransition）、执行状态映射（TASK-008
 * mapResultToStatus）与依赖级联（TASK-008 cascadeBlock）组合为 application 层的
 * 「读 frontmatter → 校验转移合法性 → 写回 status」完整用例，供 Orchestrator /
 * CLI 在任务执行结果（.result.md）或审查结论（.review.md）到达后驱动任务状态流转。
 *
 * 四个公开方法：
 *   - transition(taskId, to, context)：显式状态转移，校验 validateTransition 后写回。
 *   - applyResult(taskId, result, { orchestratorVerified })：按 §10 把 .result.md 的
 *     execution_status × next_action 映射为目标状态并转移；含 no_review 免审分支。
 *   - applyReview(taskId, review)：按 §15 把 review_result 映射为目标状态；skipped
 *     走 no_review 产物校验分支。
 *   - cascadeIfBlocked(taskId, allTasks)：前置进入 rejected/failed/blocked 时，按 §7
 *     依赖级联把后继逐个尝试流转到 blocked，能流转者写回、不能者显式跳过。
 *
 * 设计约束（任务 §8 / ARCHITECTURE.md §4 / AGENTS.md §3）：
 *   - 对文档仓储的依赖一律经 application/ports.ts 的 TaskDocRepositoryPort，不直接
 *     import infrastructure 实现类，不依赖 SQLite（索引同步由 CLI 层在编排外部组合）。
 *   - 所有状态变更必须先过 core.validateTransition，非法转移抛错不静默。
 *   - 不自行修改全局文档（PROGRESS/DECISIONS/ISSUES）——那是合并回写职责（TASK-020）；
 *     不做合并回写（TASK-019/020）。
 *   - 不做鉴权（「谁有权触发」由上层在构造 TransitionContext.confirmed 前自行判定，
 *     状态机只消费布尔，见 TASK-007）。
 *
 * 权威来源：根目录 Readme.md §7（状态机与级联）/ §10（执行结果映射）/ §15（审查映射）。
 */
import type {
  CascadeTask,
  ResultFrontmatter,
  ReviewFrontmatter,
  TaskFrontmatter,
  TaskId,
  TaskStatus,
  TransitionContext,
} from '../core/index.js'
import {
  cascadeBlock,
  mapResultToStatus,
  validateTransition,
} from '../core/index.js'
import type { TaskDocRepositoryPort } from './ports.js'

/**
 * cascadeIfBlocked 的返回：成功 blocked 的后继 + 因状态机不允许而跳过的后继。
 *
 * 级联是尽力推进：后继当前状态能合法流转到 blocked（如 running / reviewing）则写回
 * blocked；不能（如 ready / draft / 已终态）则记入 skipped 并附状态机给出的原因，
 * 由调用方（Orchestrator）据 skipped 转人工或记 issue——不静默丢失（AGENTS.md §3）。
 */
export interface CascadeOutcome {
  /** 成功流转到 blocked 的后继任务 id（cascadeBlock 返回顺序）。 */
  readonly blocked: TaskId[]
  /** 无法合法流转到 blocked 的后继，每项附状态机原因。 */
  readonly skipped: ReadonlyArray<{ id: TaskId; reason: string }>
}

/**
 * 任务状态流转编排器。
 *
 * 构造注入 TaskDocRepositoryPort（由 CLI composition root wiring 具体仓储 / 适配器，
 * ARCHITECTURE.md §4）。所有读写经 Port，本类不持有任务状态副本——每次操作即时读
 * frontmatter、校验、写回，避免多步操作间的状态漂移。
 */
export class StateOrchestrator {
  constructor(private readonly repo: TaskDocRepositoryPort) {}

  /**
   * 显式状态转移：校验 validateTransition(from=当前 status, to, context) 通过后写回。
   *
   * context 由调用方构造：no_review 取任务 frontmatter，confirmed 表「是否经
   * Orchestrator / 人工确认」（failed→* 与 done→blocked 需要，§7）。非法转移抛错，
   * 不静默放行（任务 §8）。
   */
  transition(
    taskId: TaskId,
    to: TaskStatus,
    context: TransitionContext,
  ): void {
    const task = this.repo.readTask(taskId)
    this.applyTransition(task, to, context)
  }

  /**
   * 按 §10 把 .result.md 的 execution_status × next_action 映射为目标状态并转移。
   *
   * 流程：读任务 → mapResultToStatus（noReview 取 frontmatter，orchestratorVerified
   * 由调用方传入）→ 非法组合抛错 / 合法映射再过 validateTransition 写回。典型在任务
   * 处于 running、Executor 写完 .result.md 后由 Orchestrator 调用。
   *
   * orchestratorVerified 仅在 completed + review + no_review 时影响结果（免审直 done
   * 或校验未过改 blocked，§7）；其余映射不读此字段，调用方可传 false 占位。
   */
  applyResult(
    taskId: TaskId,
    result: ResultFrontmatter,
    options: { orchestratorVerified: boolean },
  ): void {
    const task = this.repo.readTask(taskId)
    this.applyResultForTask(task, result, options.orchestratorVerified)
  }

  /**
   * 按 §15 把 review_result 映射为目标状态并转移。
   *
   * approved→done、rejected→rejected、needs-human-confirmation→blocked（§15 固定映射）；
   * skipped 表示 no_review 任务 Reviewer 不介入，改走产物校验分支：读 .result.md，
   * 校验产物齐全（见 isResultAcceptable）后委托 applyResult 决定 done（齐全）或
   * blocked（不齐全），复用 §7/§10 的 no_review 三分逻辑，避免重复实现。
   */
  applyReview(taskId: TaskId, review: ReviewFrontmatter): void {
    const task = this.repo.readTask(taskId)
    const context: TransitionContext = {
      no_review: task.no_review,
      confirmed: false,
    }
    switch (review.review_result) {
      case 'approved':
        this.applyTransition(task, 'done', context)
        return
      case 'rejected':
        this.applyTransition(task, 'rejected', context)
        return
      case 'needs-human-confirmation':
        this.applyTransition(task, 'blocked', context)
        return
      case 'skipped': {
        // no_review 任务：Reviewer 不介入，由 Orchestrator 校验 .result.md 产物后决定。
        const result = this.repo.readResult(taskId)
        this.applyResultForTask(task, result, this.isResultAcceptable(result))
        return
      }
      default: {
        // 穷尽性检查：ReviewResult 新增值时编译期暴露。
        const _exhaustive: never = review.review_result
        throw new Error(
          `状态编排：未覆盖的 review_result=${String(_exhaustive)}`,
        )
      }
    }
  }

  /**
   * 依赖级联：当 taskId 处于 rejected/failed/blocked 时，按 §7 把其全部后继逐个尝试
   * 流转到 blocked。
   *
   * 用 core.cascadeBlock 计算后继集合（传递闭包），对每个后继读当前 frontmatter、过
   * validateTransition(当前, blocked)：通过则写回 blocked，不通过则记 skipped（附原因）。
   * taskId 非触发态时 cascadeBlock 返回空数组，结果为空级联。
   *
   * 返回 CascadeOutcome 让调用方知情：skipped 非空表示部分后继因状态机不允许（如
   * ready / draft 无 →blocked 边，见 ISS-006）未能级联，需转人工裁定。
   */
  cascadeIfBlocked(
    taskId: TaskId,
    allTasks: readonly CascadeTask[],
  ): CascadeOutcome {
    const toBlock = cascadeBlock(taskId, allTasks)
    const blocked: TaskId[] = []
    const skipped: Array<{ id: TaskId; reason: string }> = []
    for (const id of toBlock) {
      const task = this.repo.readTask(id)
      const result = validateTransition(task.status, 'blocked', {
        no_review: task.no_review,
        confirmed: false,
      })
      if (result.ok) {
        this.repo.writeTask({ ...task, status: 'blocked' })
        blocked.push(id)
      } else {
        skipped.push({ id, reason: result.reason })
      }
    }
    return { blocked, skipped }
  }

  /* ============================================================ *
   * 私有：状态写回与结果映射的共享逻辑
   * ============================================================ */

  /**
   * 校验单次转移合法后写回 status（非法抛错）。
   *
   * 不读 frontmatter——由调用方传入已读的 task，避免 transition / applyResult /
   * applyReview 各自重复读取。写回时仅替换 status，其余 frontmatter 字段原样保留
   *（body 未传，仓储保留现有正文，DEC-008）。
   */
  private applyTransition(
    task: TaskFrontmatter,
    to: TaskStatus,
    context: TransitionContext,
  ): void {
    const result = validateTransition(task.status, to, context)
    if (!result.ok) {
      throw new Error(`状态编排：${result.reason}`)
    }
    this.repo.writeTask({ ...task, status: to })
  }

  /**
   * 把 .result.md 映射为目标状态并对已读 task 转移（applyResult 与 applyReview 的
   * skipped 分支共享）。
   *
   * mapResultToStatus 返回 ok:false（非法组合）时抛错转人工（DEC-005：不得静默兜底）；
   * ok:true 时目标状态再过 validateTransition（DEC-005：最终合法性闸门）。confirmed
   * 取 false——本方法从 running 出发的合法转移均不依赖 confirmed（failed→* 与
   * done→blocked 的 confirmed 闸门由 transition 显式入口承载）；任何非法 from 都会被
   * validateTransition 拦截抛错。
   */
  private applyResultForTask(
    task: TaskFrontmatter,
    result: ResultFrontmatter,
    orchestratorVerified: boolean,
  ): void {
    const mapping = mapResultToStatus(
      result.execution_status,
      result.next_action,
      { noReview: task.no_review, orchestratorVerified },
    )
    if (!mapping.ok) {
      throw new Error(`状态编排：${mapping.reason}`)
    }
    this.applyTransition(task, mapping.status, {
      no_review: task.no_review,
      confirmed: false,
    })
  }

  /**
   * no_review 任务的「产物齐全」校验（§7/§15，任务 §12 风险点）。
   *
   * 清单（Orchestrator 职责，与 Reviewer 独立审查区分）：
   *   - .result.md 可读且通过 Schema：由 readResult 保证（不抛错即结构合法）。
   *   - 验证结果无失败项：verification 中无 result === 'failed'（passed / skipped 放行）。
   *   - 全局更新建议结构齐全：global_update_requests 三子项由 ResultFrontmatterSchema
   *     强制（readResult 通过即满足），内容是否非空不强制（任务可能确实无更新）。
   *
   * 返回 true→免审直 done，false→改走 blocked（§7）。
   */
  private isResultAcceptable(result: ResultFrontmatter): boolean {
    return result.verification.every((v) => v.result !== 'failed')
  }
}
