import { describe, expect, it } from 'vitest'
import {
  canTransition,
  TASK_TRANSITIONS,
  validateTransition,
} from '../../src/core/index.js'
import { TaskStatusSchema } from '../../src/core/index.js'
import type { TaskStatus, TransitionContext } from '../../src/core/index.js'

/**
 * §7 权威状态集合（9 态）——从 enums 派生，避免与状态机自身表循环依赖。
 */
const ALL_STATES = TaskStatusSchema.options as readonly TaskStatus[]

/**
 * Readme.md §7 流转规则的合法边（独立硬编码，与状态机内部表互为交叉校验）。
 * 共 22 条结构合法边（含 running->done 这条 no_review 专用边）。
 */
const LEGAL_EDGES: ReadonlyArray<readonly [TaskStatus, TaskStatus]> = [
  ['draft', 'ready'],
  ['draft', 'cancelled'],
  ['ready', 'running'],
  ['ready', 'draft'],
  ['ready', 'cancelled'],
  ['running', 'reviewing'],
  ['running', 'blocked'],
  ['running', 'failed'],
  ['running', 'cancelled'],
  ['running', 'done'],
  ['reviewing', 'done'],
  ['reviewing', 'rejected'],
  ['reviewing', 'blocked'],
  ['reviewing', 'cancelled'],
  ['rejected', 'ready'],
  ['rejected', 'cancelled'],
  ['blocked', 'ready'],
  ['blocked', 'failed'],
  ['blocked', 'cancelled'],
  ['failed', 'ready'],
  ['failed', 'cancelled'],
  ['done', 'blocked'],
]

/** 任意布尔上下文都应放行的边（不依赖 no_review / confirmed）。 */
const CONTEXT_FREE_EDGES = LEGAL_EDGES.filter(
  ([from, to]) =>
    !(from === 'running' && to === 'done') &&
    !(from === 'failed') &&
    !(from === 'done'),
)

/** 上下文标记位组合全覆盖。 */
const CONTEXTS: ReadonlyArray<TransitionContext> = [
  { no_review: false, confirmed: false },
  { no_review: false, confirmed: true },
  { no_review: true, confirmed: false },
  { no_review: true, confirmed: true },
]

/* ============================================================ *
 * canTransition —— §7 流转表结构合法性矩阵审计
 * ============================================================ */

describe('canTransition：§7 流转表完整矩阵', () => {
  it('每条合法边返回 true', () => {
    for (const [from, to] of LEGAL_EDGES) {
      expect(canTransition(from, to), `应允许 ${from} -> ${to}`).toBe(true)
    }
  })

  it('9x9 矩阵中非合法边一律返回 false（含自流转与缺边）', () => {
    const legalSet = new Set(LEGAL_EDGES.map(([f, t]) => `${f}->${t}`))
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const expected = legalSet.has(`${from}->${to}`)
        expect(canTransition(from, to), `${from} -> ${to} 应为 ${expected}`).toBe(expected)
      }
    }
  })

  it('cancelled 为终态，向任意状态流转均为 false', () => {
    for (const to of ALL_STATES) {
      expect(canTransition('cancelled', to), `cancelled -> ${to}`).toBe(false)
    }
  })

  it('自流转一律非法（draft->draft 等 9 个自环均 false）', () => {
    for (const s of ALL_STATES) {
      expect(canTransition(s, s), `${s} -> ${s}`).toBe(false)
    }
  })

  it('TASK_TRANSITIONS 导出表与 LEGAL_EDGES 一致（防止表与规则漂移）', () => {
    for (const from of ALL_STATES) {
      const declared = TASK_TRANSITIONS[from]
      for (const to of ALL_STATES) {
        const inTable = declared.includes(to)
        const inSpec = LEGAL_EDGES.some(([f, t]) => f === from && t === to)
        expect(inTable, `表中 ${from}->${to} 应与 §7 一致`).toBe(inSpec)
      }
    }
  })
})

/* ============================================================ *
 * validateTransition —— 结构合法性 + 上下文前置条件
 * ============================================================ */

describe('validateTransition：非法转移返回 ok:false + reason', () => {
  it('表外非法转移返回 ok:false 且 reason 非空', () => {
    const illegalCases: ReadonlyArray<readonly [TaskStatus, TaskStatus]> = [
      ['draft', 'running'],
      ['running', 'rejected'],
      ['running', 'ready'],
      ['reviewing', 'running'],
      ['done', 'done'],
      ['cancelled', 'ready'],
      ['blocked', 'running'],
    ]
    for (const [from, to] of illegalCases) {
      const r = validateTransition(from, to, { no_review: false, confirmed: false })
      expect(r.ok, `${from}->${to} 应非法`).toBe(false)
      if (!r.ok) {
        expect(r.reason.length, `${from}->${to} 的 reason 不应为空`).toBeGreaterThan(0)
        expect(r.from).toBe(from)
        expect(r.to).toBe(to)
      }
    }
  })
})

describe('validateTransition：上下文无关边对任意 context 都合法', () => {
  it('draft->ready / ready->running / reviewing->done 等不依赖标记位', () => {
    for (const [from, to] of CONTEXT_FREE_EDGES) {
      for (const ctx of CONTEXTS) {
        const r = validateTransition(from, to, ctx)
        expect(r.ok, `${from}->${to} 在 ctx=${JSON.stringify(ctx)} 下应合法`).toBe(true)
      }
    }
  })

  it('合法返回 ok:true 并回填 from / to', () => {
    const r = validateTransition('draft', 'ready', { no_review: false, confirmed: false })
    expect(r).toEqual({ ok: true, from: 'draft', to: 'ready' })
  })
})

/* ============================================================ *
 * running -> done 的 no_review 前置条件（验收 §11）
 * ============================================================ */

describe('validateTransition：running -> done 受 no_review 约束', () => {
  it('no_review:false 时非法（禁止跳过 reviewing 直接 done）', () => {
    const r = validateTransition('running', 'done', { no_review: false, confirmed: true })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('no_review')
    }
  })

  it('no_review:true 时合法', () => {
    const r = validateTransition('running', 'done', { no_review: true, confirmed: false })
    expect(r.ok).toBe(true)
  })

  it('正常审查路径 running->reviewing 无需 no_review 即合法', () => {
    const r = validateTransition('running', 'reviewing', { no_review: false, confirmed: false })
    expect(r.ok).toBe(true)
  })

  it('reviewing->done（审查通过）无需 no_review 即合法', () => {
    const r = validateTransition('reviewing', 'done', { no_review: false, confirmed: false })
    expect(r.ok).toBe(true)
  })
})

/* ============================================================ *
 * failed -> * 的 confirmed 前置条件（§7：仅 Orchestrator / 人工确认）
 * ============================================================ */

describe('validateTransition：failed 流转受 confirmed 约束', () => {
  it('failed->ready 在 confirmed:false 时非法', () => {
    const r = validateTransition('failed', 'ready', { no_review: false, confirmed: false })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('确认')
    }
  })

  it('failed->ready 在 confirmed:true 时合法', () => {
    const r = validateTransition('failed', 'ready', { no_review: false, confirmed: true })
    expect(r.ok).toBe(true)
  })

  it('failed->cancelled 在 confirmed:false 时非法', () => {
    const r = validateTransition('failed', 'cancelled', { no_review: false, confirmed: false })
    expect(r.ok).toBe(false)
  })

  it('failed->cancelled 在 confirmed:true 时合法', () => {
    const r = validateTransition('failed', 'cancelled', { no_review: false, confirmed: true })
    expect(r.ok).toBe(true)
  })
})

/* ============================================================ *
 * done -> blocked 的 confirmed 前置条件（§12 风险：重开易遗漏）
 * ============================================================ */

describe('validateTransition：done -> blocked 重开受 confirmed 约束', () => {
  it('confirmed:false 时非法（done 默认终态，重开需人工介入）', () => {
    const r = validateTransition('done', 'blocked', { no_review: false, confirmed: false })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('blocked')
    }
  })

  it('confirmed:true 时合法（reopen 严重回归）', () => {
    const r = validateTransition('done', 'blocked', { no_review: false, confirmed: true })
    expect(r.ok).toBe(true)
  })

  it('done 只能流向 blocked（done->其余任意状态均非法）', () => {
    for (const to of ALL_STATES) {
      if (to === 'blocked') continue
      const r = validateTransition('done', to, { no_review: true, confirmed: true })
      expect(r.ok, `done->${to} 应非法`).toBe(false)
    }
  })
})

/* ============================================================ *
 * cancelled 终态（§12 风险：终态易遗漏）
 * ============================================================ */

describe('validateTransition：cancelled 终态不可流转', () => {
  it('cancelled 向任意状态（含自身）流转均 ok:false', () => {
    for (const to of ALL_STATES) {
      const r = validateTransition('cancelled', to, { no_review: true, confirmed: true })
      expect(r.ok, `cancelled->${to} 应非法`).toBe(false)
    }
  })
})

/* ============================================================ *
 * 续跑语义边界（§7：rejected->ready / blocked->ready 默认续跑）
 * ============================================================ */

describe('validateTransition：续跑回 ready 无需额外确认', () => {
  it('rejected->ready / blocked->ready 对任意 context 合法', () => {
    for (const ctx of CONTEXTS) {
      expect(validateTransition('rejected', 'ready', ctx).ok).toBe(true)
      expect(validateTransition('blocked', 'ready', ctx).ok).toBe(true)
    }
  })
})
