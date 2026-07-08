import { describe, expect, it } from 'vitest'
import {
  cascadeBlock,
  detectDependencyCycle,
  mapResultToStatus,
  transitiveDependents,
} from '../../../src/core/index.js'
import type {
  CascadeTask,
  ExecutionStatus,
  NextAction,
  StatusMappingContext,
} from '../../../src/core/index.js'

/* ============================================================ *
 * 测试夹具：依赖图
 *
 *   A
 *   ├── B ── C ──┐
 *   │            ├── E   （E 经 C、D 两条路径依赖 A，验证去重）
 *   └── D ───────┘
 *   └── F ── G
 *
 * transitiveDependents('A') 的 BFS 发现顺序 = [B, D, F, C, E, G]。
 * ============================================================ */

/** 构造一个任务（默认 status=done，depends_on 由参数指定）。 */
function task(
  id: string,
  depends_on: readonly string[] = [],
  status: CascadeTask['status'] = 'done',
): CascadeTask {
  return { id, depends_on, status }
}

/** §10 测试夹具图（全部 done，级联测试单独覆盖 status）。 */
function fixtureGraph(): CascadeTask[] {
  return [
    task('A'),
    task('B', ['A']),
    task('C', ['B']),
    task('D', ['A']),
    task('E', ['C', 'D']),
    task('F', ['A']),
    task('G', ['F']),
  ]
}

/* ============================================================ *
 * transitiveDependents —— 传递闭包
 * ============================================================ */

describe('transitiveDependents：传递闭包', () => {
  it('返回全部直接与间接后继（多层 + 多路径汇聚去重）', () => {
    expect(transitiveDependents('A', fixtureGraph())).toEqual([
      'B',
      'D',
      'F',
      'C',
      'E',
      'G',
    ])
  })

  it('仅含直接后继时返回单层结果', () => {
    expect(transitiveDependents('F', fixtureGraph())).toEqual(['G'])
  })

  it('叶子任务（无后继）返回空数组', () => {
    expect(transitiveDependents('G', fixtureGraph())).toEqual([])
    expect(transitiveDependents('E', fixtureGraph())).toEqual([])
  })

  it('结果不含自身', () => {
    expect(transitiveDependents('A', fixtureGraph())).not.toContain('A')
  })

  it('多路径汇聚的后继只出现一次（E 经 C、D 两路径，仍去重）', () => {
    const deps = transitiveDependents('A', fixtureGraph())
    expect(deps.filter((id) => id === 'E')).toEqual(['E'])
  })

  it('依赖指向集合外任务时忽略（不抛错、不计入后继）', () => {
    const graph = [
      task('A'),
      task('B', ['A', 'X']), // X 不在集合内
    ]
    expect(transitiveDependents('A', graph)).toEqual(['B'])
  })

  it('未知 taskId 抛错（显式暴露输入错误）', () => {
    expect(() => transitiveDependents('Z', fixtureGraph())).toThrow(
      /不在任务集合中/,
    )
  })
})

/* ============================================================ *
 * detectDependencyCycle —— 环形依赖检测
 * ============================================================ */

describe('detectDependencyCycle：环形依赖检测', () => {
  it('DAG 返回 null', () => {
    expect(detectDependencyCycle(fixtureGraph())).toBeNull()
  })

  it('空集合返回 null', () => {
    expect(detectDependencyCycle([])).toBeNull()
  })

  it('自环（A depends_on A）返回闭合环 [A, A]', () => {
    expect(detectDependencyCycle([task('A', ['A'])])).toEqual(['A', 'A'])
  })

  it('两节点环（A->B->A）返回闭合环', () => {
    const cycle = detectDependencyCycle([
      task('A', ['B']),
      task('B', ['A']),
    ])
    expect(cycle).toEqual(['A', 'B', 'A'])
  })

  it('三节点环（A->B->C->A）返回闭合环', () => {
    const cycle = detectDependencyCycle([
      task('A', ['B']),
      task('B', ['C']),
      task('C', ['A']),
    ])
    expect(cycle).toEqual(['A', 'B', 'C', 'A'])
  })

  it('环出现在子图中也能检出', () => {
    // A->B->C->B（B、C 互为环，A 在环外指向环）。
    const cycle = detectDependencyCycle([
      task('A', ['B']),
      task('B', ['C']),
      task('C', ['B']),
    ])
    expect(cycle).not.toBeNull()
    expect(cycle).toContain('B')
    expect(cycle).toContain('C')
  })

  it('transitiveDependents 遇到环形依赖抛错（不死循环）', () => {
    expect(() =>
      transitiveDependents('A', [
        task('A', ['B']),
        task('B', ['A']),
      ]),
    ).toThrow(/环形依赖/)
  })
})

/* ============================================================ *
 * cascadeBlock —— §7 依赖级联
 * ============================================================ */

describe('cascadeBlock：§7 依赖级联', () => {
  it('rejected 触发级联，返回全部后继闭包', () => {
    const graph = fixtureGraph().map((t) =>
      t.id === 'A' ? { ...t, status: 'rejected' as const } : t,
    )
    expect(cascadeBlock('A', graph)).toEqual(['B', 'D', 'F', 'C', 'E', 'G'])
  })

  it('failed 触发级联', () => {
    const graph = fixtureGraph().map((t) =>
      t.id === 'A' ? { ...t, status: 'failed' as const } : t,
    )
    expect(cascadeBlock('A', graph)).toEqual(['B', 'D', 'F', 'C', 'E', 'G'])
  })

  it('blocked 触发级联', () => {
    const graph = fixtureGraph().map((t) =>
      t.id === 'A' ? { ...t, status: 'blocked' as const } : t,
    )
    expect(cascadeBlock('A', graph)).toEqual(['B', 'D', 'F', 'C', 'E', 'G'])
  })

  it.each([
    'draft',
    'ready',
    'running',
    'reviewing',
    'done',
    'cancelled',
  ] as const)('非触发态 %s 返回空数组（不级联）', (status) => {
    const graph = fixtureGraph().map((t) =>
      t.id === 'A' ? { ...t, status } : t,
    )
    expect(cascadeBlock('A', graph)).toEqual([])
  })

  it('中间节点级联只影响其后继（不向上扩散）', () => {
    // C 失败：其后继只有 E（A、B 不受影响，因为它们是 C 的前置）。
    const graph = fixtureGraph().map((t) =>
      t.id === 'C' ? { ...t, status: 'failed' as const } : t,
    )
    expect(cascadeBlock('C', graph)).toEqual(['E'])
  })

  it('未知 taskId 抛错', () => {
    expect(() => cascadeBlock('Z', fixtureGraph())).toThrow(/不在任务集合中/)
  })
})

/* ============================================================ *
 * mapResultToStatus —— §10 映射表
 * ============================================================ */

const NEEDS_REVIEW: StatusMappingContext = { noReview: false, orchestratorVerified: false }
const NO_REVIEW_VERIFIED: StatusMappingContext = { noReview: true, orchestratorVerified: true }
const NO_REVIEW_UNVERIFIED: StatusMappingContext = { noReview: true, orchestratorVerified: false }

describe('mapResultToStatus：§10 合法映射', () => {
  it('completed + review（需审查）-> reviewing', () => {
    const r = mapResultToStatus('completed', 'review', NEEDS_REVIEW)
    expect(r).toEqual({ ok: true, status: 'reviewing' })
  })

  it('completed + review + no_review + 校验通过 -> done（免审直 done）', () => {
    const r = mapResultToStatus('completed', 'review', NO_REVIEW_VERIFIED)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.status).toBe('done')
      expect(r.note).toMatch(/免审直 done/)
    }
  })

  it('completed + review + no_review + 校验未通过 -> blocked（§7 改走 blocked）', () => {
    const r = mapResultToStatus('completed', 'review', NO_REVIEW_UNVERIFIED)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.status).toBe('blocked')
      expect(r.note).toMatch(/校验产物未通过/)
    }
  })

  it('completed + needs-human -> blocked', () => {
    expect(mapResultToStatus('completed', 'needs-human', NEEDS_REVIEW)).toEqual({
      ok: true,
      status: 'blocked',
    })
  })

  it('blocked + needs-human -> blocked', () => {
    expect(mapResultToStatus('blocked', 'needs-human', NEEDS_REVIEW)).toEqual({
      ok: true,
      status: 'blocked',
    })
  })

  it('blocked + retry -> blocked', () => {
    expect(mapResultToStatus('blocked', 'retry', NEEDS_REVIEW)).toEqual({
      ok: true,
      status: 'blocked',
    })
  })

  it('failed + retry -> failed', () => {
    expect(mapResultToStatus('failed', 'retry', NEEDS_REVIEW)).toEqual({
      ok: true,
      status: 'failed',
    })
  })

  it('failed + needs-human -> failed', () => {
    expect(mapResultToStatus('failed', 'needs-human', NEEDS_REVIEW)).toEqual({
      ok: true,
      status: 'failed',
    })
  })

  it.each([
    'completed',
    'blocked',
    'failed',
  ] as const)('* + cancel -> cancelled（任意 execution_status）', (status) => {
    expect(mapResultToStatus(status, 'cancel', NEEDS_REVIEW)).toEqual({
      ok: true,
      status: 'cancelled',
    })
  })
})

describe('mapResultToStatus：§10 非法组合显式报错', () => {
  it.each([
    ['completed', 'retry'],
    ['blocked', 'review'],
    ['failed', 'review'],
  ] as readonly [ExecutionStatus, NextAction][])(
    '%s + %s 返回 ok:false + reason',
    (executionStatus, nextAction) => {
      const r = mapResultToStatus(executionStatus, nextAction, NEEDS_REVIEW)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.reason).toMatch(/非法组合/)
        expect(r.executionStatus).toBe(executionStatus)
        expect(r.nextAction).toBe(nextAction)
      }
    },
  )
})

describe('mapResultToStatus：12 组合全覆盖矩阵', () => {
  // 预期矩阵（NEEDS_REVIEW 上下文）：3 非法 + 9 合法。
  const expected: ReadonlyArray<{
    status: ExecutionStatus
    action: NextAction
    ok: boolean
    target?: string
  }> = [
    { status: 'completed', action: 'review', ok: true, target: 'reviewing' },
    { status: 'completed', action: 'needs-human', ok: true, target: 'blocked' },
    { status: 'completed', action: 'retry', ok: false },
    { status: 'completed', action: 'cancel', ok: true, target: 'cancelled' },
    { status: 'blocked', action: 'review', ok: false },
    { status: 'blocked', action: 'needs-human', ok: true, target: 'blocked' },
    { status: 'blocked', action: 'retry', ok: true, target: 'blocked' },
    { status: 'blocked', action: 'cancel', ok: true, target: 'cancelled' },
    { status: 'failed', action: 'review', ok: false },
    { status: 'failed', action: 'needs-human', ok: true, target: 'failed' },
    { status: 'failed', action: 'retry', ok: true, target: 'failed' },
    { status: 'failed', action: 'cancel', ok: true, target: 'cancelled' },
  ]

  for (const { status, action, ok, target } of expected) {
    it(`${status} + ${action} -> ${ok ? target : '非法'}`, () => {
      const r = mapResultToStatus(status, action, NEEDS_REVIEW)
      expect(r.ok).toBe(ok)
      if (ok && r.ok && target) {
        expect(r.status).toBe(target)
      }
    })
  }
})
