import { describe, expect, it } from 'vitest'
import {
  detectParallelizable,
  mergeOrder,
  topologicalOrder,
} from '../../src/application/index.js'
import type { TaskFrontmatter, TaskId } from '../../src/core/index.js'

/* ============================================================ *
 * 测试夹具
 * ============================================================ */

/**
 * 构造一份合法 TaskFrontmatter，按需覆盖与本模块相关的字段。
 *
 * 其余字段用安全默认值填充，聚焦 id / depends_on / allowed_paths 三个调度关心的维度。
 * 直接传完整 TaskFrontmatter 而非投影对象，验证 SchedulerTask 的结构类型兼容性。
 */
function makeTask(
  overrides: {
    id?: TaskId
    depends_on?: TaskId[]
    allowed_paths?: string[]
  } = {},
): TaskFrontmatter {
  return {
    id: overrides.id ?? 'TASK-001',
    title: '测试任务',
    status: 'ready',
    layer: 'domain',
    depends_on: overrides.depends_on ?? [],
    allowed_paths: overrides.allowed_paths ?? [],
    forbidden_paths: [],
    permissions: [],
    no_review: false,
    restart_on_retry: false,
    verification: [],
    context_pack: {
      required_docs: [],
      optional_doc_excerpts: [],
      source_files: [],
    },
    workflow_outputs: {
      result_file: 'docs/tasks/TASK-001-test.result.md',
    },
  }
}

/** 断言拓扑序合法：任一任务的（集合内）依赖都排在它之前（任务 §11 验收）。 */
function expectTopologicallyValid(
  order: readonly TaskId[],
  tasks: readonly TaskFrontmatter[],
): void {
  const index = new Map<TaskId, number>(order.map((id, i) => [id, i]))
  for (const t of tasks) {
    const ti = index.get(t.id)
    if (ti === undefined) throw new Error(`任务 ${t.id} 未出现在拓扑序中`)
    for (const dep of t.depends_on) {
      const di = index.get(dep)
      if (di === undefined) continue // 外部依赖跳过
      if (di >= ti) {
        throw new Error(`依赖 ${dep}（位置 ${di}）未排在 ${t.id}（位置 ${ti}）之前`)
      }
    }
  }
}

/** 断言可并行批次的拓扑依赖序：任一任务的（集合内）依赖都在更早批次中（§3.2）。 */
function expectBatchesRespectDependencies(
  batches: readonly (readonly TaskId[])[],
  tasks: readonly TaskFrontmatter[],
): void {
  const batchOf = new Map<TaskId, number>()
  batches.forEach((batch, i) => {
    for (const id of batch) batchOf.set(id, i)
  })
  for (const t of tasks) {
    const bi = batchOf.get(t.id)
    if (bi === undefined) throw new Error(`任务 ${t.id} 未出现在任何批次中`)
    for (const dep of t.depends_on) {
      const di = batchOf.get(dep)
      if (di === undefined) continue // 外部依赖跳过
      if (di >= bi) {
        throw new Error(
          `依赖 ${dep}（批次 ${di}）未排在 ${t.id}（批次 ${bi}）的更早批次`,
        )
      }
    }
  }
}

/* ============================================================ *
 * topologicalOrder：被依赖方在前
 * ============================================================ */

describe('topologicalOrder：被依赖方在前', () => {
  it('线性链 A<-B<-C → [A,B,C]', () => {
    const tasks = [
      makeTask({ id: 'TASK-003', depends_on: ['TASK-002'] }),
      makeTask({ id: 'TASK-001' }),
      makeTask({ id: 'TASK-002', depends_on: ['TASK-001'] }),
    ]
    const order = topologicalOrder(tasks)
    expect(order).toEqual(['TASK-001', 'TASK-002', 'TASK-003'])
    expectTopologicallyValid(order, tasks)
  })

  it('菱形 A<-B,A<-C,B<-D,C<-D → A 在前 D 在后', () => {
    const tasks = [
      makeTask({ id: 'TASK-001' }),
      makeTask({ id: 'TASK-002', depends_on: ['TASK-001'] }),
      makeTask({ id: 'TASK-003', depends_on: ['TASK-001'] }),
      makeTask({ id: 'TASK-004', depends_on: ['TASK-002', 'TASK-003'] }),
    ]
    const order = topologicalOrder(tasks)
    expect(order).toEqual(['TASK-001', 'TASK-002', 'TASK-003', 'TASK-004'])
    expectTopologicallyValid(order, tasks)
  })

  it('无依赖任务按 id 数值升序（鲁棒于补零）', () => {
    const tasks = [
      makeTask({ id: 'TASK-010' }),
      makeTask({ id: 'TASK-002' }),
      makeTask({ id: 'TASK-001' }),
    ]
    expect(topologicalOrder(tasks)).toEqual(['TASK-001', 'TASK-002', 'TASK-010'])
  })

  it('空集合 → []', () => {
    expect(topologicalOrder([])).toEqual([])
  })

  it('输入乱序时输出仍稳定（确定性）', () => {
    const a = [
      makeTask({ id: 'TASK-002', depends_on: ['TASK-001'] }),
      makeTask({ id: 'TASK-001' }),
    ]
    const b = [
      makeTask({ id: 'TASK-001' }),
      makeTask({ id: 'TASK-002', depends_on: ['TASK-001'] }),
    ]
    expect(topologicalOrder(a)).toEqual(topologicalOrder(b))
  })

  it('外部依赖（指向集合外任务）被忽略不报错', () => {
    const tasks = [makeTask({ id: 'TASK-001', depends_on: ['TASK-999'] })]
    expect(topologicalOrder(tasks)).toEqual(['TASK-001'])
  })

  it('多依赖任务在其全部依赖之后（验收不变量）', () => {
    const tasks = [
      makeTask({ id: 'TASK-001' }),
      makeTask({ id: 'TASK-002' }),
      makeTask({ id: 'TASK-003', depends_on: ['TASK-001', 'TASK-002'] }),
    ]
    const order = topologicalOrder(tasks)
    expectTopologicallyValid(order, tasks)
    expect(order.indexOf('TASK-003')).toBeGreaterThan(order.indexOf('TASK-001'))
    expect(order.indexOf('TASK-003')).toBeGreaterThan(order.indexOf('TASK-002'))
  })
})

describe('topologicalOrder：环形依赖抛错', () => {
  it('双向依赖环 A<->B 抛错', () => {
    const tasks = [
      makeTask({ id: 'TASK-001', depends_on: ['TASK-002'] }),
      makeTask({ id: 'TASK-002', depends_on: ['TASK-001'] }),
    ]
    expect(() => topologicalOrder(tasks)).toThrowError(/环形依赖|DAG/)
  })

  it('自环（依赖自身）抛错', () => {
    const tasks = [makeTask({ id: 'TASK-001', depends_on: ['TASK-001'] })]
    expect(() => topologicalOrder(tasks)).toThrowError(/环形依赖|DAG/)
  })

  it('三元环 A->B->C->A 抛错', () => {
    const tasks = [
      makeTask({ id: 'TASK-001', depends_on: ['TASK-003'] }),
      makeTask({ id: 'TASK-002', depends_on: ['TASK-001'] }),
      makeTask({ id: 'TASK-003', depends_on: ['TASK-002'] }),
    ]
    expect(() => topologicalOrder(tasks)).toThrowError(/环形依赖|DAG/)
  })

  it('含可用部分但有环时整体抛错（不部分返回）', () => {
    // TASK-001 可独立完成，但 TASK-002/TASK-003 成环。
    const tasks = [
      makeTask({ id: 'TASK-001' }),
      makeTask({ id: 'TASK-002', depends_on: ['TASK-003'] }),
      makeTask({ id: 'TASK-003', depends_on: ['TASK-002'] }),
    ]
    expect(() => topologicalOrder(tasks)).toThrowError(/环形依赖|DAG/)
  })
})

describe('topologicalOrder：输入校验', () => {
  it('重复 id 抛错', () => {
    const tasks = [makeTask({ id: 'TASK-001' }), makeTask({ id: 'TASK-001' })]
    expect(() => topologicalOrder(tasks)).toThrowError(/重复任务 id/)
  })
})

/* ============================================================ *
 * mergeOrder：合并回收拓扑序
 * ============================================================ */

describe('mergeOrder：合并回收拓扑序（§3.2 先合并被依赖方）', () => {
  it('与 topologicalOrder 同向（被依赖方在前）', () => {
    const tasks = [
      makeTask({ id: 'TASK-003', depends_on: ['TASK-002'] }),
      makeTask({ id: 'TASK-001' }),
      makeTask({ id: 'TASK-002', depends_on: ['TASK-001'] }),
    ]
    expect(mergeOrder(tasks)).toEqual(['TASK-001', 'TASK-002', 'TASK-003'])
    expect(mergeOrder(tasks)).toEqual(topologicalOrder(tasks))
  })

  it('环形依赖抛错', () => {
    const tasks = [
      makeTask({ id: 'TASK-001', depends_on: ['TASK-002'] }),
      makeTask({ id: 'TASK-002', depends_on: ['TASK-001'] }),
    ]
    expect(() => mergeOrder(tasks)).toThrowError(/环形依赖|DAG/)
  })

  it('空集合 → []', () => {
    expect(mergeOrder([])).toEqual([])
  })
})

/* ============================================================ *
 * detectParallelizable：拓扑分层
 * ============================================================ */

describe('detectParallelizable：拓扑分层', () => {
  it('线性链 → 每层单任务（无并行）', () => {
    const tasks = [
      makeTask({ id: 'TASK-001' }),
      makeTask({ id: 'TASK-002', depends_on: ['TASK-001'] }),
      makeTask({ id: 'TASK-003', depends_on: ['TASK-002'] }),
    ]
    expect(detectParallelizable(tasks)).toEqual([
      ['TASK-001'],
      ['TASK-002'],
      ['TASK-003'],
    ])
  })

  it('菱形 + B/C 路径不重叠 → B,C 同批并行', () => {
    const tasks = [
      makeTask({ id: 'TASK-001', allowed_paths: ['src/a.ts'] }),
      makeTask({
        id: 'TASK-002',
        depends_on: ['TASK-001'],
        allowed_paths: ['src/b.ts'],
      }),
      makeTask({
        id: 'TASK-003',
        depends_on: ['TASK-001'],
        allowed_paths: ['src/c.ts'],
      }),
      makeTask({
        id: 'TASK-004',
        depends_on: ['TASK-002', 'TASK-003'],
        allowed_paths: ['src/d.ts'],
      }),
    ]
    const batches = detectParallelizable(tasks)
    expect(batches).toEqual([
      ['TASK-001'],
      ['TASK-002', 'TASK-003'],
      ['TASK-004'],
    ])
    expectBatchesRespectDependencies(batches, tasks)
  })

  it('空集合 → []', () => {
    expect(detectParallelizable([])).toEqual([])
  })

  it('单任务 → [[TASK-001]]', () => {
    expect(detectParallelizable([makeTask({ id: 'TASK-001' })])).toEqual([
      ['TASK-001'],
    ])
  })
})

/* ============================================================ *
 * detectParallelizable：路径重叠剔除（保守，§3.2/§8）
 * ============================================================ */

describe('detectParallelizable：路径重叠剔除（保守策略）', () => {
  it('相同文件路径 → 拆分不可并行', () => {
    const tasks = [
      makeTask({ id: 'TASK-001', allowed_paths: ['src/shared.ts'] }),
      makeTask({ id: 'TASK-002', allowed_paths: ['src/shared.ts'] }),
    ]
    expect(detectParallelizable(tasks)).toEqual([['TASK-001'], ['TASK-002']])
  })

  it('目录包含（祖先关系）→ 拆分', () => {
    const tasks = [
      makeTask({ id: 'TASK-001', allowed_paths: ['src/core'] }),
      makeTask({ id: 'TASK-002', allowed_paths: ['src/core/enums.ts'] }),
    ]
    expect(detectParallelizable(tasks)).toEqual([['TASK-001'], ['TASK-002']])
  })

  it('glob 与具体文件相交 → 拆分', () => {
    const tasks = [
      makeTask({ id: 'TASK-001', allowed_paths: ['src/core/**/*.ts'] }),
      makeTask({ id: 'TASK-002', allowed_paths: ['src/core/enums.ts'] }),
    ]
    expect(detectParallelizable(tasks)).toEqual([['TASK-001'], ['TASK-002']])
  })

  it('兄弟文件路径不重叠 → 可并行', () => {
    const tasks = [
      makeTask({ id: 'TASK-001', allowed_paths: ['src/a.ts'] }),
      makeTask({ id: 'TASK-002', allowed_paths: ['src/b.ts'] }),
    ]
    expect(detectParallelizable(tasks)).toEqual([['TASK-001', 'TASK-002']])
  })

  it('不相交目录 → 可并行', () => {
    const tasks = [
      makeTask({ id: 'TASK-001', allowed_paths: ['src/core/x.ts'] }),
      makeTask({ id: 'TASK-002', allowed_paths: ['docs/y.md'] }),
    ]
    expect(detectParallelizable(tasks)).toEqual([['TASK-001', 'TASK-002']])
  })

  it('空 allowed_paths（只读任务）与任何任务不冲突', () => {
    const tasks = [
      makeTask({ id: 'TASK-001', allowed_paths: [] }),
      makeTask({ id: 'TASK-002', allowed_paths: ['src/a.ts'] }),
    ]
    expect(detectParallelizable(tasks)).toEqual([['TASK-001', 'TASK-002']])
  })

  it('两个空 allowed_paths 任务可并行', () => {
    const tasks = [makeTask({ id: 'TASK-001' }), makeTask({ id: 'TASK-002' })]
    expect(detectParallelizable(tasks)).toEqual([['TASK-001', 'TASK-002']])
  })

  it('Windows 反斜杠路径与正斜杠等价判定重叠', () => {
    const tasks = [
      makeTask({ id: 'TASK-001', allowed_paths: ['src\\core\\enums.ts'] }),
      makeTask({ id: 'TASK-002', allowed_paths: ['src/core'] }),
    ]
    expect(detectParallelizable(tasks)).toEqual([['TASK-001'], ['TASK-002']])
  })

  it('根级通配（*.ts）保守视为与一切重叠', () => {
    const tasks = [
      makeTask({ id: 'TASK-001', allowed_paths: ['*.ts'] }),
      makeTask({ id: 'TASK-002', allowed_paths: ['src/a.ts'] }),
    ]
    expect(detectParallelizable(tasks)).toEqual([['TASK-001'], ['TASK-002']])
  })

  it('同层三任务：冲突者拆开，不冲突者可与先入组并行', () => {
    // TASK-002 与 TASK-003 都写 src/shared.ts（冲突）；TASK-001 写独立文件。
    // 层内按 id 升序：001 先入组，002 与 001 不冲突可同组，003 与组内 002 冲突 → 新组。
    const tasks = [
      makeTask({ id: 'TASK-001', allowed_paths: ['src/a.ts'] }),
      makeTask({ id: 'TASK-002', allowed_paths: ['src/shared.ts'] }),
      makeTask({ id: 'TASK-003', allowed_paths: ['src/shared.ts'] }),
    ]
    expect(detectParallelizable(tasks)).toEqual([
      ['TASK-001', 'TASK-002'],
      ['TASK-003'],
    ])
  })
})

/* ============================================================ *
 * detectParallelizable：批次拓扑依赖序
 * ============================================================ */

describe('detectParallelizable：批次拓扑依赖序', () => {
  it('任一批次内的任务只依赖更早批次的任务', () => {
    const tasks = [
      makeTask({ id: 'TASK-001', allowed_paths: ['src/a.ts'] }),
      makeTask({
        id: 'TASK-002',
        depends_on: ['TASK-001'],
        allowed_paths: ['src/b.ts'],
      }),
      makeTask({
        id: 'TASK-003',
        depends_on: ['TASK-001'],
        allowed_paths: ['src/c.ts'],
      }),
      makeTask({
        id: 'TASK-004',
        depends_on: ['TASK-002'],
        allowed_paths: ['src/d.ts'],
      }),
      makeTask({
        id: 'TASK-005',
        depends_on: ['TASK-003', 'TASK-004'],
        allowed_paths: ['src/e.ts'],
      }),
    ]
    const batches = detectParallelizable(tasks)
    expectBatchesRespectDependencies(batches, tasks)
  })

  it('环形依赖抛错', () => {
    const tasks = [
      makeTask({ id: 'TASK-001', depends_on: ['TASK-002'] }),
      makeTask({ id: 'TASK-002', depends_on: ['TASK-001'] }),
    ]
    expect(() => detectParallelizable(tasks)).toThrowError(/环形依赖|DAG/)
  })

  it('重复 id 抛错', () => {
    const tasks = [makeTask({ id: 'TASK-001' }), makeTask({ id: 'TASK-001' })]
    expect(() => detectParallelizable(tasks)).toThrowError(/重复任务 id/)
  })
})
