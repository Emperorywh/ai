import { describe, expect, it } from 'vitest'
import {
  DecisionStatusSchema,
  ExecutionStatusSchema,
  IssueSeveritySchema,
  IssueStatusSchema,
  LayerSchema,
  NextActionSchema,
  PermissionSchema,
  ProgressModeSchema,
  ReviewResultSchema,
  ScopeSchema,
  ScopeStageSchema,
  TaskIdSchema,
  TaskStatusSchema,
} from '../../src/core/index.js'

/**
 * 通用校验辅助：避免每个枚举重复手写「合法值通过 / 非法值拒绝」样板。
 * 只依赖 safeParse 的结构类型，不耦合 zod 内部类型，保持 core 测试零反向依赖。
 */
type Parsable = { safeParse: (v: unknown) => { success: boolean } }

function expectAccepts(schema: Parsable, values: unknown[]): void {
  for (const v of values) {
    expect(schema.safeParse(v).success, `应接受 ${JSON.stringify(v)}`).toBe(true)
  }
}

function expectRejects(schema: Parsable, values: unknown[]): void {
  for (const v of values) {
    expect(schema.safeParse(v).success, `应拒绝 ${JSON.stringify(v)}`).toBe(false)
  }
}

/** 通用非法样本：对任何封闭枚举都应被拒绝（空串 / 无关串 / 各基础类型）。 */
const COMMON_INVALID: unknown[] = ['', 'random-string', 0, true, null, undefined, {}]

/* -------- 以下 7 个枚举有 Readme.md 权威取值，断言声明值数量 -------- */

describe('LayerSchema（Readme.md §9，7 值）', () => {
  it('接受全部声明值且数量为 7', () => {
    expectAccepts(LayerSchema, LayerSchema.options)
    expect(LayerSchema.options).toHaveLength(7)
  })
  it('拒绝非法值', () => {
    expectRejects(LayerSchema, ['STATE', 'business', 'layer', ...COMMON_INVALID])
  })
})

describe('PermissionSchema（Readme.md §16，9 项）', () => {
  it('接受全部声明值且数量为 9', () => {
    expectAccepts(PermissionSchema, PermissionSchema.options)
    expect(PermissionSchema.options).toHaveLength(9)
  })
  it('拒绝非法值', () => {
    expectRejects(PermissionSchema, ['write', 'exec', 'network', ...COMMON_INVALID])
  })
})

describe('TaskStatusSchema（Readme.md §7，9 态）', () => {
  it('接受全部声明值且数量为 9', () => {
    expectAccepts(TaskStatusSchema, TaskStatusSchema.options)
    expect(TaskStatusSchema.options).toHaveLength(9)
  })
  it('拒绝非法值', () => {
    expectRejects(TaskStatusSchema, ['pending', 'success', 'error', ...COMMON_INVALID])
  })
})

describe('ExecutionStatusSchema（Readme.md §10，3 值）', () => {
  it('接受全部声明值且数量为 3', () => {
    expectAccepts(ExecutionStatusSchema, ExecutionStatusSchema.options)
    expect(ExecutionStatusSchema.options).toHaveLength(3)
  })
  it('拒绝非法值', () => {
    expectRejects(ExecutionStatusSchema, ['success', 'done', 'running', ...COMMON_INVALID])
  })
})

describe('NextActionSchema（Readme.md §10，4 值）', () => {
  it('接受全部声明值且数量为 4', () => {
    expectAccepts(NextActionSchema, NextActionSchema.options)
    expect(NextActionSchema.options).toHaveLength(4)
  })
  it('拒绝非法值', () => {
    expectRejects(NextActionSchema, ['wait', 'proceed', 'needs_human', ...COMMON_INVALID])
  })
})

describe('ReviewResultSchema（Readme.md §15，4 值）', () => {
  it('接受全部声明值且数量为 4', () => {
    expectAccepts(ReviewResultSchema, ReviewResultSchema.options)
    expect(ReviewResultSchema.options).toHaveLength(4)
  })
  it('拒绝非法值', () => {
    expectRejects(ReviewResultSchema, ['approved!', 'pending', 'skipped-review', ...COMMON_INVALID])
  })
})

describe('ProgressModeSchema（Readme.md §10，2 值）', () => {
  it('接受全部声明值且数量为 2', () => {
    expectAccepts(ProgressModeSchema, ProgressModeSchema.options)
    expect(ProgressModeSchema.options).toHaveLength(2)
  })
  it('拒绝非法值', () => {
    expectRejects(ProgressModeSchema, ['merge', 'overwrite', 'prepend', ...COMMON_INVALID])
  })
})

/* -------- Scope：阶段标识 + 任务 id 的异构联合 -------- */

describe('ScopeStageSchema（Readme.md §6.6/§6.7）', () => {
  it('接受 SPEC / ARCHITECTURE', () => {
    expectAccepts(ScopeStageSchema, ['SPEC', 'ARCHITECTURE'])
  })
  it('拒绝小写、任务 id 与通用非法值', () => {
    expectRejects(ScopeStageSchema, ['spec', 'architecture', 'TASK-001', ...COMMON_INVALID])
  })
})

describe('TaskIdSchema（TASK-\\d+ 开放集合）', () => {
  it('接受形如 TASK-\\d+ 的任务 id（含不同位数）', () => {
    expectAccepts(TaskIdSchema, ['TASK-001', 'TASK-003', 'TASK-999', 'TASK-1'])
  })
  it('拒绝缺数字 / 含字母 / 小写 / 缺连字符 / 多段等', () => {
    expectRejects(TaskIdSchema, [
      'TASK-', // 缺数字
      'TASK-001A', // 含字母
      'task-001', // 小写
      'TASK001', // 缺连字符
      '001', // 缺前缀
      'TASK-001-2', // 多段（当前正则要求单一性）
      ...COMMON_INVALID,
    ])
  })
})

describe('ScopeSchema（阶段标识 ∪ 任务 id，异构联合）', () => {
  it('同时接受阶段标识与任务 id 两类合法值', () => {
    expectAccepts(ScopeSchema, ['SPEC', 'ARCHITECTURE', 'TASK-001', 'TASK-029'])
  })
  it('拒绝非法阶段 / 任务标识', () => {
    expectRejects(ScopeSchema, [
      'spec',
      'STATE',
      'TASK-',
      'task-001',
      'TASK-1A',
      ...COMMON_INVALID,
    ])
  })
})

/* -------- 以下 3 个枚举 Readme.md 未显式枚举完整取值，
   仅断言契约（声明值全部通过 + 非法值拒绝），不写死数量，
   避免 Orchestrator 后续确认取值后测试失效。 -------- */

describe('DecisionStatusSchema（Readme.md §6.6/§10）', () => {
  it('接受全部声明值', () => {
    expectAccepts(DecisionStatusSchema, DecisionStatusSchema.options)
    expect(DecisionStatusSchema.options.length).toBeGreaterThanOrEqual(1)
  })
  it('拒绝非法值', () => {
    expectRejects(DecisionStatusSchema, ['pending', 'rejected', 'active', ...COMMON_INVALID])
  })
})

describe('IssueStatusSchema（Readme.md §6.7/§10）', () => {
  it('接受全部声明值', () => {
    expectAccepts(IssueStatusSchema, IssueStatusSchema.options)
    expect(IssueStatusSchema.options.length).toBeGreaterThanOrEqual(1)
  })
  it('拒绝非法值', () => {
    expectRejects(IssueStatusSchema, ['closed', 'pending', 'wontfix', ...COMMON_INVALID])
  })
})

describe('IssueSeveritySchema（Readme.md §6.7/§10/§17）', () => {
  it('接受全部声明值', () => {
    expectAccepts(IssueSeveritySchema, IssueSeveritySchema.options)
    expect(IssueSeveritySchema.options.length).toBeGreaterThanOrEqual(1)
  })
  it('拒绝非法值', () => {
    expectRejects(IssueSeveritySchema, ['blocker', 'info', 'urgent', ...COMMON_INVALID])
  })
})
