/**
 * Core 执行状态映射（Readme.md §10 execution_status × next_action → 目标状态）。
 *
 * 把 .result.md frontmatter 的 execution_status（Executor 的执行结论）与 next_action
 * （Executor 的建议下一步）映射为任务的目标 TaskStatus，供 Orchestrator（TASK-017）
 * 在读取 .result.md 后决定状态流转。
 *
 * 设计约束（任务 §8）：
 *   - 纯函数。复用 enums 的 TaskStatus / ExecutionStatus / NextAction 枚举，但不直接
 *     调用 state-machine.validateTransition——映射产出的是「目标状态建议」，最终合法性
 *     可由调用方再过状态机（如 running -> done 仍需状态机放行 no_review 边）。
 *   - 非法组合必须显式报错，不静默兜底。
 *   - 不实现 Reviewer 结论映射（approved -> done 等属编排，由 TASK-017 组合状态机实现，
 *     见任务 §7「不做什么」）。
 *
 * 硬约束（AGENTS.md §2 / docs/ARCHITECTURE.md §3）：零反向依赖，仅依赖同层 enums
 * 的类型（不引入 zod，输入由上层 Zod 解析后以枚举值传入）。
 *
 * 权威来源：根目录 Readme.md §10（映射表与非法组合清单）。
 */
import type { ExecutionStatus, NextAction, TaskStatus } from '../enums.js'

/* ============================================================ *
 * 映射上下文与返回类型
 * ============================================================ */

/**
 * 状态映射的上下文（由 Orchestrator 从 frontmatter / 产物校验结果构造后传入）。
 *
 *   - noReview：任务 frontmatter 是否声明 no_review: true。
 *     决定 completed + review 走「免审直 done」分支还是正常进 reviewing（§7）。
 *   - orchestratorVerified：no_review 任务执行完成后，Orchestrator 是否校验产物通过
 *     （.result.md 完整性、验证结果、全局更新建议齐全）。校验通过才置 done，否则按 §7
 *     改走 blocked（产物校验不通过、等人工）。仅在 completed + review + no_review 时
 *     影响结果；其余映射不读此字段。
 */
export interface StatusMappingContext {
  readonly noReview: boolean
  readonly orchestratorVerified: boolean
}

/**
 * mapResultToStatus 的返回：合法映射 / 非法组合 + 原因。
 *
 * 与 state-machine.validateTransition 的 TransitionResult 同构——返回判别联合而非
 * 抛异常，便于 Orchestrator 收集问题后统一处理（非法组合是 frontmatter 数据错误，
 * Orchestrator 应记录并转人工，而非中断整个编排流程）。
 *   - ok:true 携带 status 与可选 note：note 仅在特殊映射（免审直 done、校验失败的
 *     blocked）时给出，便于审计与日志；常规映射 note 留空。
 *   - ok:false 携带 reason 与输入回显，供 Orchestrator 记录 issue。
 */
export type StatusMappingResult =
  | { readonly ok: true; readonly status: TaskStatus; readonly note?: string }
  | {
      readonly ok: false
      readonly reason: string
      readonly executionStatus: ExecutionStatus
      readonly nextAction: NextAction
    }

/* ============================================================ *
 * §10 非法组合清单
 * ============================================================ */

/**
 * §10 明确的非法组合：Zod Schema 阶段不硬拒（TASK-005 只校验单字段枚举），组合合法性
 * 由本函数在运行期判定并报错。key 形如 `${executionStatus}+${nextAction}`。
 */
const ILLEGAL_COMBINATIONS: ReadonlyMap<string, string> = new Map<string, string>([
  ['completed+retry', '已完成无需重试'],
  ['blocked+review', '被阻塞的任务不进入审查'],
  ['failed+review', '失败的任务不进入审查'],
])

/* ============================================================ *
 * 映射主函数（§10 映射表）
 * ============================================================ */

/**
 * 把 .result.md 的 execution_status × next_action 映射为目标 TaskStatus（§10）。
 *
 * 映射表（合法组合）：
 *   completed + review       -> reviewing（默认进审查）
 *                                no_review + 校验通过 -> done
 *                                no_review + 校验未通过 -> blocked（§7：改走 blocked）
 *   completed + needs-human  -> blocked
 *   blocked   + needs-human  -> blocked
 *   blocked   + retry        -> blocked（待 Orchestrator/人工确认后 -> ready）
 *   failed    + retry        -> failed（待 Orchestrator/人工确认后 -> ready）
 *   failed    + needs-human  -> failed
 *   *         + cancel       -> cancelled（需 Orchestrator/人工确认）
 *
 * 非法组合（completed+retry / blocked+review / failed+review）返回 ok:false + reason。
 * 调用方对 ok:false 应记录并转人工，不得静默取默认值（AGENTS.md §3）。
 *
 * @returns 判别联合：合法时 { ok:true, status, note? }，非法时 { ok:false, reason, ... }。
 */
export function mapResultToStatus(
  executionStatus: ExecutionStatus,
  nextAction: NextAction,
  context: StatusMappingContext,
): StatusMappingResult {
  // 第一层：非法组合显式报错（§10 清单）。
  const key = `${executionStatus}+${nextAction}`
  const illegalReason = ILLEGAL_COMBINATIONS.get(key)
  if (illegalReason !== undefined) {
    return {
      ok: false,
      reason: `非法组合：execution_status=${executionStatus} × next_action=${nextAction}（${illegalReason}）`,
      executionStatus,
      nextAction,
    }
  }

  // 第二层：cancel 对任意 execution_status 一律映射 cancelled（§10：需 Orchestrator/人工确认）。
  if (nextAction === 'cancel') {
    return { ok: true, status: 'cancelled' }
  }

  // 第三层：按 executionStatus 分派（此时 nextAction ∈ {review, needs-human, retry}，
  // 非法组合已在第一层排除）。
  switch (executionStatus) {
    case 'completed':
      // nextAction ∈ {review, needs-human}。
      if (nextAction === 'review') {
        // completed + review：依 no_review 与 Orchestrator 校验结果三分（§7 / §10）。
        if (context.noReview) {
          return context.orchestratorVerified
            ? {
                ok: true,
                status: 'done',
                note: 'no_review: true 且 Orchestrator 校验产物通过，免审直 done（§7）',
              }
            : {
                ok: true,
                status: 'blocked',
                note: 'no_review: true 但 Orchestrator 校验产物未通过，改走 blocked（§7）',
              }
        }
        return { ok: true, status: 'reviewing' }
      }
      // nextAction === 'needs-human'。
      return { ok: true, status: 'blocked' }

    case 'blocked':
      // nextAction ∈ {needs-human, retry}：均保持 blocked（待 Orchestrator/人工确认后 -> ready）。
      return { ok: true, status: 'blocked' }

    case 'failed':
      // nextAction ∈ {retry, needs-human}：均保持 failed（待 Orchestrator/人工确认后 -> ready）。
      return { ok: true, status: 'failed' }

    default: {
      // 穷尽性检查：ExecutionStatus 新增值时此处编译报错，强制开发者补全映射。
      const _exhaustive: never = executionStatus
      throw new Error(
        `状态映射：未覆盖 execution_status=${String(_exhaustive)}（请补全 §10 映射）`,
      )
    }
  }
}
