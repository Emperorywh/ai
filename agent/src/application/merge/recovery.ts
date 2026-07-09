/**
 * Application 合并编排：幂等恢复（Readme.md §3.2）。
 *
 * 合并链路（rebase → 回填 execution_commits → fast-forward → 全局文档串行回写）任一步崩溃后，
 * 恢复逻辑按 git 状态判定重建进度——用 GitMergePort.branchMerged（等价 git branch --merged）
 * 检查 worktree 分支是否已 fast-forward 进入 main：已进入则跳过合并、仅补做未完成的全局文档
 * 回写；未进入则丢弃上次不完整的 rebase 中间态（abortOrCleanRebase），从 main 最新基线重新
 * 走 rebaseAndFastForward 合并链路。合并进度不写 SQLite，可从 git 状态 + frontmatter status
 * 完全重建（§3.2）。
 *
 * 设计约束（任务 §7 / §8 / §12 / AGENTS.md §2 / ARCHITECTURE.md §4）：
 *   - 对 git 原语与文档仓储的依赖一律经 application/ports.ts 的 GitMergePort /
 *     TaskDocRepositoryPort / GlobalDocRepositoryPort，不直接 import infrastructure 实现类。
 *   - 恢复判定只依赖 git 状态（branchMerged）+ 复用 TASK-019 合并链路 + TASK-020 section 回写，
 *     不依赖外部「合并进度文件」（§3.2），不把合并进度写 SQLite（任务 §7），不修改状态机
 *     判定逻辑（任务 §7）。
 *   - 不修改 rebase-ff.ts / section-writeback.ts（任务 §6 复用不改），仅组合调用。
 *
 * 「不完整 rebase 中间态」的可靠判据（任务 §12 难点）：以 branchMerged==false 作为唯一恢复
 * 分叉点——只要分支尚未进入 main，合并即未完成，此时无论是否存在遗留的 rebase 中间态，一律
 * 先 abortOrCleanRebase（幂等：有中间态则 abort、无中间态则 no-op）再重新合并。避免在本编排
 * 重复实现脆弱的 rebase 目录探测（探测归 GitMergePort.abortOrCleanRebase 内部，TASK-018），
 * 也避免「探测到中间态才 abort、否则直接 rebase」会在 rebase 进行中二次 rebase 报错的陷阱。
 *
 * 权威来源：根目录 Readme.md §3.2（合并操作必须幂等可恢复）。
 */
import type { TaskId } from '../../core/index.js'
import type { GlobalDocRepositoryPort } from '../ports.js'
import {
  rebaseAndFastForward,
  type MergePorts,
  type MergeTask,
  type MergeTaskResult,
} from './rebase-ff.js'
import {
  writebackGlobalDocs,
  type IdAllocator,
  type WritebackOutcome,
  type WritebackRequest,
} from './section-writeback.js'

/* ============================================================ *
 * 注入端口与恢复结果
 * ============================================================ */

/**
 * 恢复用例注入的端口聚合（由 CLI composition root wiring 具体实现，ARCHITECTURE.md §4）。
 *
 * 在 MergePorts（git + docs，复用 TASK-019 合并链路所需）基础上增加 globalRepo（TASK-020
 * section 回写所需）——恢复既要重做合并（git + docs）又要补做全局文档回写（globalRepo）。
 * 结构类型兼容：CLI wiring 时 infra GitMergeAdapter + 按 taskId 路由的 TaskDocRepository
 * 适配器（ISS-009）+ 全局文档 I/O 适配器（DEC-012）一并注入，本编排只消费 Port 接口。
 */
export interface RecoveryPorts extends MergePorts {
  /** 全局文档读写与 section 合并 Port（补做未完成回写用，TASK-020）。 */
  readonly globalRepo: GlobalDocRepositoryPort
}

/**
 * 恢复动作（由 mergeResult.ok 区分红蓝两种结局）。
 *
 *   - skipped-merged：worktree 分支已 ff 进 main，幂等跳过合并（不重复合并），补做回写。
 *   - redone-merged：丢弃中间态后重新 rebase+ff 成功进入 main，补做回写。
 *   - redone-conflict：丢弃中间态后重新 rebase 仍冲突，不回写——冲突清单随 mergeResult 返回，
 *     交 Orchestrator 仲裁置 blocked / 写 ISSUES（§3.2 / 任务 §7 不在本编排仲裁）。
 */
export type MergeRecoveryAction = 'skipped-merged' | 'redone-merged' | 'redone-conflict'

/**
 * recoverMerge 返回值。
 *
 *   - taskId：恢复的目标任务。
 *   - action：恢复动作（见 MergeRecoveryAction）。
 *   - mergeResult：单任务合并结果——skipped-merged / redone-merged 为 ok:true（已进 main），
 *     redone-conflict 为 ok:false + 冲突清单（unmerged 文件）。
 *   - writeback：合并完成（ok:true）时补做的全局文档回写结果；冲突（ok:false）时不回写（null），
 *     交 Orchestrator 先仲裁冲突再决定是否回写。
 */
export interface MergeRecoveryOutcome {
  readonly taskId: TaskId
  readonly action: MergeRecoveryAction
  readonly mergeResult: MergeTaskResult
  readonly writeback: WritebackOutcome | null
}

/* ============================================================ *
 * 公开 API
 * ============================================================ */

/**
 * 合并幂等恢复（Readme.md §3.2）。
 *
 * 按 git 状态判定崩溃后该任务的合并进度并恢复，使整个合并可从任意崩溃点继续：
 *
 *   1. branchMerged(taskId, mainRef)：检查 worktree 分支是否已 fast-forward 进入 main。
 *   2. 已进入（branchMerged==true）→ 幂等跳过合并（不 rebase / 不 ff，避免重复合并）。
 *   3. 未进入（branchMerged==false）→ abortOrCleanRebase(taskId) 丢弃上次不完整的 rebase
 *      中间态（幂等），再从 main 最新基线重新走 rebaseAndFastForward 合并链路（§3.2）。
 *   4. 合并完成（skipped-merged / redone-merged，mergeResult.ok==true）→ 调 writebackGlobalDocs
 *      补做该任务的全局文档 section 回写（§3.2「仅补做未完成的全局文档回写」）；冲突
 *      （redone-conflict）不回写，冲突清单随 mergeResult 返回交 Orchestrator 仲裁。
 *
 * 「补做回写」语义：恢复无法判定回写是否已部分完成（§3.2 合并进度不写 SQLite），故合并完成
 * 时一律重新执行回写——decisions / issues 按 id 去重（writebackGlobalDocs 内建，幂等）、
 * progress replace 后写者覆盖（幂等）；progress append 在重复恢复时可能重复追加，由调用方
 * （Orchestrator）控制恢复调用次数（一次崩溃一次恢复），本编排不二次判重。
 *
 * 二次恢复幂等（任务 §11）：已进入 main 的任务二次恢复仍命中 branchMerged==true → 跳过合并，
 * 不重复合并（合并的幂等保证）；回写按上述语义重做。
 *
 * @param taskId 恢复的目标任务 id（须与 task.id 一致，否则抛错）。
 * @param options.ports 注入端口聚合（git + docs + globalRepo）。
 * @param options.task 任务投影（复用 TASK-019 MergeTask，供 rebaseAndFastForward 重合并）。
 * @param options.mainRef 目标主分支短名（如 'main'），branchMerged / rebase / ff 均以它为参照。
 * @param options.writebackRequest 该任务的全局文档回写请求（合并完成时补做）。
 * @param options.idAllocator id 分配器（DEC-XXX / ISS-XXX，补做回写用）。
 */
export function recoverMerge(
  taskId: TaskId,
  options: {
    readonly ports: RecoveryPorts
    readonly task: MergeTask
    readonly mainRef: string
    readonly writebackRequest: WritebackRequest
    readonly idAllocator: IdAllocator
  },
): MergeRecoveryOutcome {
  const { ports, task, mainRef, writebackRequest, idAllocator } = options

  // taskId 与任务投影必须一致——防御性校验，不一致抛错不静默（AGENTS.md §4）。
  if (task.id !== taskId) {
    throw new Error(
      `recoverMerge 入参不一致：taskId=${taskId} 但 task.id=${task.id}`,
    )
  }

  // 1. 判定 worktree 分支是否已 fast-forward 进入 main（§3.2 git branch --merged 语义）。
  const alreadyMerged = ports.git.branchMerged(taskId, mainRef)

  let action: MergeRecoveryAction
  let mergeResult: MergeTaskResult

  if (alreadyMerged) {
    // 已进入 main → 幂等跳过合并（不 rebase / 不 ff，二次恢复不重复合并，任务 §11）。
    action = 'skipped-merged'
    mergeResult = { ok: true, taskId }
  } else {
    // 未进入 main → 丢弃上次不完整的 rebase 中间态（幂等：有则 abort、无则 no-op，§12 难点）。
    // 必须在 rebaseOnto 之前清理，否则 git 在 rebase 进行中二次 rebase 会直接报错。
    ports.git.abortOrCleanRebase(taskId)
    // 从 main 最新基线重新走 TASK-019 合并链路（rebase + 回填 + audit + ff）。
    const outcome = rebaseAndFastForward(
      { git: ports.git, docs: ports.docs },
      [task],
      { mainRef },
    )
    // 单任务恢复：合并结果集合中取本任务（单元素，防御性 find）。
    const own = outcome.results.find((r) => r.taskId === taskId)
    if (own === undefined) {
      // 单任务 rebaseAndFastForward 不会进 skipped（无集合内依赖后继），到此处属异常，不静默。
      throw new Error(`recoverMerge 重新合并未产出 ${taskId} 的结果`)
    }
    mergeResult = own
    action = own.ok ? 'redone-merged' : 'redone-conflict'
  }

  // 2. 合并完成（已进入 main）→ 补做全局文档回写（§3.2）；冲突不回写（交 Orchestrator 仲裁）。
  const writeback = mergeResult.ok
    ? writebackGlobalDocs(ports.globalRepo, [writebackRequest], { idAllocator })
    : null

  return { taskId, action, mergeResult, writeback }
}
