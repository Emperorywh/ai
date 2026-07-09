/**
 * Application 合并编排：rebase + 回填 + fast-forward（Readme.md §3.2）。
 *
 * 把 GitMergePort 的 git 底层原语与 TaskDocRepositoryPort 的文档读写，按 §3.2 合并链路
 * 顺序串联为 application 层的合并用例：按 depends_on 拓扑序逐任务——rebase 到最新 main →
 * 探测冲突（不抛断）→ 无冲突则采集 post-rebase 实现 commit、回填 .result.md 的
 * execution_commits、提交独立 audit commit、fast-forward 回收 main；冲突则清理中间态
 * 返回冲突清单，不破坏 main。冲突任务的传递后继按 §3.2「不得先于依赖回收」连带跳过。
 *
 * 设计约束（任务 §7 / §8 / AGENTS.md §2 / ARCHITECTURE.md §4）：
 *   - 对 git 原语与文档仓储的依赖一律经 application/ports.ts 的 GitMergePort /
 *     TaskDocRepositoryPort，不直接 import infrastructure 实现类。
 *   - 合并顺序由 depends_on 拓扑序决定（先合并被依赖方），复用 TASK-016 mergeOrder；
 *     冲突后继的传递闭包复用 TASK-008 transitiveDependents（§3.2 拓扑约束）。
 *   - 审计元信息在 rebase 之后、fast-forward 之前回填；collectPostRebaseCommits 必须在
 *     commitAuditResult 之前调用，确保 execution_commits 只含实现 commit、不含 audit
 *     commit（§3.2 / 任务 §12 最高风险点）。
 *   - 不产生 merge commit（fastForwardMain 线性快进）；冲突不抛断、不破坏 main。
 *   - 不做合并冲突的仲裁决策（置 blocked / 写 ISSUES 归 Orchestrator，任务 §7）；
 *     不做全局文档 section 回写（TASK-020）；不做幂等恢复（TASK-021）。
 *
 * 权威来源：根目录 Readme.md §3.2（并行执行与 worktree 合并策略）。
 */
import type { ExecutionCommit, TaskId, TaskStatus } from '../../core/index.js'
import { transitiveDependents } from '../../core/index.js'
import { mergeOrder } from '../scheduler.js'
import type { GitMergePort, TaskDocRepositoryPort } from '../ports.js'

/* ============================================================ *
 * 最小任务投影与注入端口
 * ============================================================ */

/**
 * 合并所需的最小任务投影。
 *
 * id 用于 git 操作（worktree 分支 / commit 采集），depends_on 决定合并拓扑序，
 * workflow_outputs.result_file 是 .result.md 相对仓库路径（audit commit 的提交目标）。
 * 结构类型——TaskFrontmatter（含 id / depends_on / workflow_outputs）可直接传入，
 * 无需显式转换，应用层不必为合并另行装配数据。
 */
export interface MergeTask {
  readonly id: TaskId
  readonly depends_on: readonly TaskId[]
  readonly workflow_outputs: { readonly result_file: string }
}

/**
 * 合并用例注入的端口聚合（由 CLI composition root wiring 具体实现，ARCHITECTURE.md §4）。
 *
 *   - git：GitMergePort，提供 rebase / ff / commit 采集 / audit 提交 / 冲突探测 / 清理原语。
 *   - docs：TaskDocRepositoryPort，读 / 写 .result.md frontmatter（回填 execution_commits）。
 *
 * 多 worktree 合并场景下，docs 需按 taskId 路由到对应 worktree 的 docs/tasks（git 原语已
 * 天然按 taskId 经 WorktreePort/GitMergePort 寻址）；该路由由 CLI wiring 层组合适配器满足，
 * 本编排只消费 port 接口（见 DEC 备注）。
 */
export interface MergePorts {
  readonly git: GitMergePort
  readonly docs: TaskDocRepositoryPort
}

/* ============================================================ *
 * 合并结果
 * ============================================================ */

/**
 * 单任务合并结果（判别联合）。
 *
 *   - ok:true —— rebase + 回填 + audit + ff 全链路成功，任务已 fast-forward 进 main。
 *   - ok:false —— rebase 冲突，附 unmerged 文件清单（供 Orchestrator 转 blocked + 写 ISSUES）。
 */
export type MergeTaskResult =
  | { readonly ok: true; readonly taskId: TaskId }
  | { readonly ok: false; readonly taskId: TaskId; readonly conflicts: readonly string[] }

/**
 * 一次合并调用的整体结果。
 *
 *   - merged：成功 fast-forward 进 main 的任务 id（合并序）。
 *   - conflicts：rebase 冲突的任务及冲突清单（§3.2 / 任务 §7，供 Orchestrator 仲裁置 blocked）。
 *   - skipped：因依赖任务冲突或跳过而连带未合并的后继（§3.2「不得先于依赖回收」拓扑约束）；
 *     本函数不改变这些任务的 frontmatter 状态，仅本轮跳过，由 Orchestrator 据情决策。
 *   - results：全部任务的逐项结果（合并序，仅含参与合并者，skipped 不进 results），供完整追踪。
 */
export interface RebaseFastForwardOutcome {
  readonly merged: readonly TaskId[]
  readonly conflicts: ReadonlyArray<{ taskId: TaskId; conflicts: readonly string[] }>
  readonly skipped: ReadonlyArray<{ taskId: TaskId; reason: string }>
  readonly results: readonly MergeTaskResult[]
}

/* ============================================================ *
 * 公开 API
 * ============================================================ */

/**
 * rebase + 回填 + fast-forward 合并编排（Readme.md §3.2）。
 *
 * 按 depends_on 拓扑序（mergeOrder，先合并被依赖方）逐任务执行合并链路：
 *   1. rebaseOnto(taskId, mainRef)：rebase 到最新 main，冲突不抛断（GitMergePort 契约）。
 *   2. listConflicts(taskId)：探测冲突——非空说明 rebase 停在冲突中间态。
 *   3. 冲突 → abortOrCleanRebase(taskId) 清理中间态（不破坏 main），记 conflict 清单，
 *      该任务的传递后继（transitiveDependents）连带记 skipped（§3.2 拓扑约束）。
 *   4. 无冲突 → collectPostRebaseCommits(taskId, mainRef) 采集 post-rebase 实现 commit
 *      （必须在 audit commit 之前，确保不含 audit commit，§12 风险点）。
 *   5. readResult(taskId) → writeResult(回填 execution_commits)：仅改 frontmatter，
 *      正文保留（仓储 body 未传保留语义，DEC-008）。
 *   6. commitAuditResult(taskId, result_file)：提交回填后的 .result.md 为独立 audit commit
 *      （§3.2 audit commit 只作记录载体，不计入 execution_commits）。
 *   7. fastForwardMain(taskId, mainRef)：线性快进回收 main，无 merge commit。
 *
 * mainRef 为目标主分支短名（如 'main'），rebase / collect / ff 均以它为基线参照；前序任务
 * ff 后 main 自然前进，后续任务 rebaseOnto 到最新 main（§3.2 串行合并）。
 *
 * 冲突不抛断、不破坏 main：本函数返回 conflicts 清单，由 Orchestrator 决策置 blocked /
 * 写 ISSUES（任务 §7 不做仲裁）。skipped 任务本轮不合并、不改状态，待依赖解决后重跑。
 */
export function rebaseAndFastForward(
  ports: MergePorts,
  tasks: readonly MergeTask[],
  options: { mainRef: string },
): RebaseFastForwardOutcome {
  // 合并只用拓扑序（被依赖方在前），并行路径重叠判定无关——投影为 SchedulerTask。
  const order = mergeOrder(
    tasks.map((t) => ({
      id: t.id,
      depends_on: t.depends_on,
      allowed_paths: [] as string[],
    })),
  )
  const byId = new Map<TaskId, MergeTask>(tasks.map((t) => [t.id, t] as const))
  // transitiveDependents 所需投影（传递闭包只算依赖图结构，status 填占位值）。
  const graph = tasks.map((t) => ({
    id: t.id,
    depends_on: t.depends_on,
    status: 'done' as TaskStatus,
  }))

  // 因依赖冲突 / 跳过而连带跳过的任务集合：§3.2「任何任务不得先于其依赖任务回收到主分支」。
  const pending = new Set<TaskId>()

  const results: MergeTaskResult[] = []
  const conflicts: Array<{ taskId: TaskId; conflicts: readonly string[] }> = []
  const skipped: Array<{ taskId: TaskId; reason: string }> = []

  for (const id of order) {
    if (pending.has(id)) {
      skipped.push({ taskId: id, reason: '依赖任务合并未完成（冲突或连带跳过）' })
      continue
    }
    const task = byId.get(id)
    // mergeOrder 只产出 byId 内的 id（来自同一 tasks 集合），防御性守卫。
    if (task === undefined) continue

    // 1. rebase 到最新 main（冲突不抛断，GitMergePort 契约）。
    ports.git.rebaseOnto(id, options.mainRef)

    // 2. 探测冲突：rebase 冲突停在中间态，listConflicts 列出 unmerged 文件。
    const conflictFiles = ports.git.listConflicts(id)
    if (conflictFiles.length > 0) {
      // 冲突：清理 rebase 中间态（不破坏 main），记 conflict 清单；传递后继连带跳过。
      ports.git.abortOrCleanRebase(id)
      results.push({ ok: false, taskId: id, conflicts: conflictFiles })
      conflicts.push({ taskId: id, conflicts: conflictFiles })
      for (const dep of transitiveDependents(id, graph)) {
        pending.add(dep)
      }
      continue
    }

    // 3. 采集 post-rebase 实现 commit（audit commit 之前，§12 风险点：不含 audit commit）。
    const commits: ExecutionCommit[] = ports.git.collectPostRebaseCommits(id, options.mainRef)

    // 4. 回填 execution_commits（仅改 frontmatter，正文保留）。
    const result = ports.docs.readResult(id)
    ports.docs.writeResult({ ...result, execution_commits: commits })

    // 5. 提交独立 audit commit（回填后的 .result.md 作为记录载体，§3.2）。
    ports.git.commitAuditResult(id, task.workflow_outputs.result_file)

    // 6. fast-forward 回收 main（线性快进，无 merge commit）。
    ports.git.fastForwardMain(id, options.mainRef)

    results.push({ ok: true, taskId: id })
  }

  return {
    merged: results
      .filter((r): r is { ok: true; taskId: TaskId } => r.ok)
      .map((r) => r.taskId),
    conflicts,
    skipped,
    results,
  }
}
