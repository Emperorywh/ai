/**
 * Core 任务状态机（Readme.md §7）。
 *
 * 以「数据结构（转移表） + 纯函数」表达任务状态的合法流转，供 application 层
 * 编排（TASK-017）调用。本模块只判定「结构合法性 + 上下文前置条件」：
 *   - 结构合法性：转移是否出现在 §7 流转表中（canTransition / TASK_TRANSITIONS）。
 *   - 上下文前置条件：running->done 需 no_review；failed->* 与 done->blocked
 *     需经 Orchestrator / 人工确认（validateTransition 消费 context.confirmed）。
 * 它【不做】「谁有权触发」的细粒度鉴权（那是 application / 权限层职责，见任务 §12），
 * 也【不】读写 frontmatter / SQLite（I/O 由 TASK-017 承载；状态机只读上层传入的 status）。
 *
 * 硬约束（AGENTS.md §2 / docs/ARCHITECTURE.md §3）：本文件零反向依赖，
 * 仅依赖同层 enums 的类型，不依赖 application / infrastructure / cli，
 * 也不依赖 zod（本模块无运行时校验需求，输入由上层 Zod 解析后以 TaskStatus 传入）。
 *
 * 权威来源：根目录 Readme.md §7（状态流转规则）。
 */
import type { TaskStatus } from './enums.js'

/* ============================================================ *
 * 转移表（Readme.md §7 状态流转规则的直接编码）
 * ============================================================ */

/**
 * §7 状态流转表。
 *
 * key 为起始状态，value 为该状态下结构上「可能合法」的全部目标状态。
 * 表中每条边是「存在这条流转路径」，不携带上下文前置条件；
 * running->done / failed->* / done->blocked 的额外前置条件由 validateTransition
 * 在表查询通过后再判定。cancelled 为终态，无可流转目标（空数组）。
 *
 * 以数据结构（而非散落的 if/switch）表达，便于单测做完整矩阵审计与人工核对。
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  draft: ['ready', 'cancelled'],
  ready: ['running', 'draft', 'cancelled'],
  // done 边需 validateTransition 额外校验 no_review（§7：仅当 no_review: true）。
  running: ['reviewing', 'blocked', 'failed', 'cancelled', 'done'],
  reviewing: ['done', 'rejected', 'blocked', 'cancelled'],
  rejected: ['ready', 'cancelled'],
  blocked: ['ready', 'failed', 'cancelled'],
  // ready / cancelled 两条边需 validateTransition 额外校验 confirmed（§7：仅 Orchestrator / 人工确认）。
  failed: ['ready', 'cancelled'],
  // blocked 边需 validateTransition 额外校验 confirmed（§7：仅 Orchestrator / 人工确认，reopen 严重回归）。
  done: ['blocked'],
  cancelled: [],
}

/**
 * 判定两个状态之间是否存在结构上合法的流转路径（§7 流转表是否有边）。
 *
 * 本函数只回答「这条边在不在表里」，不携带任何上下文；因此
 * running->done / failed->* / done->blocked 即便返回 true，也未必在给定上下文下合法，
 * 完整判定请用 validateTransition。自流转（如 draft->draft）一律返回 false
 * （§7 未定义任何自流转）。
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to)
}

/* ============================================================ *
 * 上下文前置条件与校验结果
 * ============================================================ */

/**
 * 状态流转的上下文前置条件（由 application 层从 frontmatter / 鉴权结果构造后传入）。
 *
 *   - no_review：任务 frontmatter 是否声明 `no_review: true`。
 *     决定 running->done 是否被允许（跳过 Reviewer 独立审查，但仍由 Orchestrator 校验产物）。
 *   - confirmed：是否经 Orchestrator 或人工确认。
 *     gate failed->ready / failed->cancelled / done->blocked——这三类流转涉及
 *     重开或失败处理，§7 明确要求人工介入，不得由 Task Executor 自行触发。
 *
 * 注意：confirmed 仅是「是否已确认」的布尔事实，不区分「谁来确认」（Orchestrator 还是
 * 具体的人）——后者属鉴权范畴，由 application 层在设置本字段前自行判定（任务 §12）。
 */
export interface TransitionContext {
  readonly no_review: boolean
  readonly confirmed: boolean
}

/**
 * validateTransition 的返回：合法 / 非法 + 原因。
 *
 * 合法时携带 from / to 便于上层日志与审计；非法时 reason 以简体中文说明
 * 不满足的结构条件或上下文前置条件，供 Orchestrator / 人工定位。
 */
export type TransitionResult =
  | { readonly ok: true; readonly from: TaskStatus; readonly to: TaskStatus }
  | {
      readonly ok: false
      readonly from: TaskStatus
      readonly to: TaskStatus
      readonly reason: string
    }

/**
 * 校验一次状态流转在给定上下文下是否合法（结构合法性 + 上下文前置条件）。
 *
 * 判定顺序：
 *   1. 结构合法性——canTransition(from, to) 为 false 即非法（边不在 §7 表中）。
 *   2. running->done——必须 context.no_review === true，否则视为「禁止跳过
 *      reviewing 直接 done」，需先进入 reviewing 审查（§7）。
 *   3. failed->ready / failed->cancelled——必须 context.confirmed === true，
 *      failed 非自动重试态，Task Executor 不得自行流转（§7）。
 *   4. done->blocked——必须 context.confirmed === true，reopen 已完成任务需人工介入（§7）。
 *
 * 通过全部检查则返回 ok:true。所有判定均为前置条件式（任一不满足即拒绝），
 * 不静默放行非法流转。
 */
export function validateTransition(
  from: TaskStatus,
  to: TaskStatus,
  context: TransitionContext,
): TransitionResult {
  // 第一层：结构合法性——转移是否出现在 §7 流转表中。
  if (!canTransition(from, to)) {
    return {
      ok: false,
      from,
      to,
      reason: `非法转移：${from} -> ${to} 不在 Readme.md §7 状态流转表中`,
    }
  }

  // 第二层：上下文前置条件——部分转移除「表中有边」外还需满足额外条件。
  if (from === 'running' && to === 'done' && !context.no_review) {
    return {
      ok: false,
      from,
      to,
      reason:
        'running -> done 仅当 no_review: true（跳过 Reviewer 独立审查，仍由 Orchestrator 校验产物）；否则禁止跳过 reviewing 直接 done',
    }
  }

  if (from === 'failed' && !context.confirmed) {
    return {
      ok: false,
      from,
      to,
      reason: `failed -> ${to} 仅允许 Orchestrator 或人工确认后流转（failed 非自动重试态，Task Executor 不得自行流转）`,
    }
  }

  if (from === 'done' && !context.confirmed) {
    return {
      ok: false,
      from,
      to,
      reason: 'done -> blocked 仅 Orchestrator 或人工确认（reopen 严重回归）',
    }
  }

  return { ok: true, from, to }
}
