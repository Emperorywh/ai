import { describe, expect, it } from 'vitest'
import { DecisionSchema, IssueSchema } from '../../../src/core/index.js'

/* -------- 合法正例：基于 Readme §6.6 / §6.7 + §10 模板 -------- */

/**
 * 决策正例：id 留空（Task Executor 提议态），created_from_task 取真实任务 id，
 * scope 取自由文本影响范围（与 §10 / TASK-003.result.md 的实际用法一致）。
 */
const validDecision = {
  id: '',
  title: '决策与问题 Schema 的 created_from_task 复用 ScopeSchema',
  status: 'proposed',
  scope: 'core',
  created_from_task: 'TASK-004',
  decision: 'created_from_task 字段统一复用 enums.ts 的 ScopeSchema 校验。',
  rationale: '单一来源，避免重复实现 SPEC / ARCHITECTURE ∪ 任务 id 的 union。',
  consequences: '后续 Schema 凡涉及来源标识一律复用 ScopeSchema。',
}

/**
 * 问题正例：id 与 owner 均留空（§10 示例 / TASK-003 提议项的真实形态），
 * severity / status 取枚举值，scope 取自由文本。
 */
const validIssue = {
  id: '',
  title: 'scope 字段语义与任务 §8「用枚举」存在张力',
  status: 'open',
  severity: 'medium',
  scope: 'core',
  created_from_task: 'TASK-004',
  owner: '',
  recommended_action: '由 Orchestrator 确认 scope 应为自由文本还是枚举后回写。',
}

/* -------- 校验辅助：保持 core 测试零反向依赖 -------- */

type Obj = Record<string, unknown>

/** 纯数据深拷贝（无函数 / 循环引用，JSON 拷贝足够）。 */
function cloneDecision(): Obj {
  return JSON.parse(JSON.stringify(validDecision)) as Obj
}
function cloneIssue(): Obj {
  return JSON.parse(JSON.stringify(validIssue)) as Obj
}

/** 返回删除指定顶层字段后的副本，用于「缺必填字段被拒」用例。 */
function omit(obj: Obj, key: string): Obj {
  const copy: Obj = { ...obj }
  delete copy[key]
  return copy
}

/** 期望 DecisionSchema 通过；失败时把 zod issues 打进断言信息，便于定位。 */
function expectValidDecision(sample: unknown): void {
  const result = DecisionSchema.safeParse(sample)
  expect(
    result.success,
    result.success ? '' : JSON.stringify(result.error.issues),
  ).toBe(true)
}
function expectInvalidDecision(sample: unknown): void {
  expect(DecisionSchema.safeParse(sample).success).toBe(false)
}
function expectValidIssue(sample: unknown): void {
  const result = IssueSchema.safeParse(sample)
  expect(
    result.success,
    result.success ? '' : JSON.stringify(result.error.issues),
  ).toBe(true)
}
function expectInvalidIssue(sample: unknown): void {
  expect(IssueSchema.safeParse(sample).success).toBe(false)
}

/* ============================================================ *
 * DecisionSchema 正例
 * ============================================================ */

describe('DecisionSchema 正例', () => {
  it('§6.6 模板形态（id 留空）通过', () => {
    expectValidDecision(validDecision)
  })

  it('id 分配后形态（DEC-XXX）通过', () => {
    expectValidDecision({ ...cloneDecision(), id: 'DEC-007' })
  })

  it('id 允许空串（Task Executor 提议态）', () => {
    expectValidDecision({ ...cloneDecision(), id: '' })
  })

  it('status 接受全部 DecisionStatus', () => {
    for (const status of ['proposed', 'accepted', 'superseded']) {
      expectValidDecision({ ...cloneDecision(), status })
    }
  })

  it('created_from_task 接受 SPEC / ARCHITECTURE / TASK-XXX', () => {
    for (const cft of ['SPEC', 'ARCHITECTURE', 'TASK-004', 'TASK-1']) {
      expectValidDecision({ ...cloneDecision(), created_from_task: cft })
    }
  })

  it('scope 接受自由文本影响范围（core / api / state）', () => {
    for (const scope of ['core', 'api', 'state', 'cli']) {
      expectValidDecision({ ...cloneDecision(), scope })
    }
  })
})

/* ============================================================ *
 * DecisionSchema 缺必填字段被拒（§11 验收）
 * ============================================================ */

describe('DecisionSchema 缺必填字段被拒', () => {
  const requiredKeys = [
    'id', 'title', 'status', 'scope',
    'created_from_task', 'decision', 'rationale', 'consequences',
  ] as const
  for (const key of requiredKeys) {
    it(`缺 ${key} 被拒`, () => {
      expectInvalidDecision(omit(cloneDecision(), key))
    })
  }
})

/* ============================================================ *
 * DecisionSchema 类型与枚举非法被拒
 * ============================================================ */

describe('DecisionSchema 类型与枚举非法被拒', () => {
  it('status 非法枚举被拒', () => {
    expectInvalidDecision({ ...cloneDecision(), status: 'closed' })
    expectInvalidDecision({ ...cloneDecision(), status: 'open' })
  })
  it('created_from_task 非法（非任务 id 也非阶段标识）被拒', () => {
    for (const cft of ['TASK-XX', 'task-004', 'TASK-', 'random', 'core', 'TYPE']) {
      expectInvalidDecision({ ...cloneDecision(), created_from_task: cft })
    }
  })
  it('title / scope / decision / rationale / consequences 空串被拒', () => {
    expectInvalidDecision({ ...cloneDecision(), title: '' })
    expectInvalidDecision({ ...cloneDecision(), scope: '' })
    expectInvalidDecision({ ...cloneDecision(), decision: '' })
    expectInvalidDecision({ ...cloneDecision(), rationale: '' })
    expectInvalidDecision({ ...cloneDecision(), consequences: '' })
  })
  it('字段类型错误被拒', () => {
    expectInvalidDecision({ ...cloneDecision(), title: 123 })
    expectInvalidDecision({ ...cloneDecision(), status: [] })
    expectInvalidDecision({ ...cloneDecision(), scope: null })
    expectInvalidDecision({ ...cloneDecision(), decision: {} })
  })
})

/* ============================================================ *
 * IssueSchema 正例
 * ============================================================ */

describe('IssueSchema 正例', () => {
  it('§6.7 模板形态（id / owner 留空）通过', () => {
    expectValidIssue(validIssue)
  })

  it('id 分配后形态（ISS-XXX）通过', () => {
    expectValidIssue({ ...cloneIssue(), id: 'ISS-004' })
  })

  it('id 允许空串（Task Executor 提议态）', () => {
    expectValidIssue({ ...cloneIssue(), id: '' })
  })

  it('owner 允许空串（尚未指派责任人）', () => {
    expectValidIssue({ ...cloneIssue(), owner: '' })
    expectValidIssue({ ...cloneIssue(), owner: '@reviewer' })
  })

  it('status 接受全部 IssueStatus', () => {
    for (const status of ['open', 'resolved']) {
      expectValidIssue({ ...cloneIssue(), status })
    }
  })

  it('severity 接受全部 IssueSeverity', () => {
    for (const severity of ['low', 'medium', 'high', 'critical']) {
      expectValidIssue({ ...cloneIssue(), severity })
    }
  })

  it('created_from_task 接受 SPEC / ARCHITECTURE / TASK-XXX', () => {
    for (const cft of ['SPEC', 'ARCHITECTURE', 'TASK-004', 'TASK-12']) {
      expectValidIssue({ ...cloneIssue(), created_from_task: cft })
    }
  })

  it('scope 接受自由文本影响范围', () => {
    for (const scope of ['api', 'state', 'core']) {
      expectValidIssue({ ...cloneIssue(), scope })
    }
  })
})

/* ============================================================ *
 * IssueSchema 缺必填字段被拒（§11 验收）
 * ============================================================ */

describe('IssueSchema 缺必填字段被拒', () => {
  const requiredKeys = [
    'id', 'title', 'status', 'severity', 'scope',
    'created_from_task', 'owner', 'recommended_action',
  ] as const
  for (const key of requiredKeys) {
    it(`缺 ${key} 被拒`, () => {
      expectInvalidIssue(omit(cloneIssue(), key))
    })
  }
})

/* ============================================================ *
 * IssueSchema 类型与枚举非法被拒
 * ============================================================ */

describe('IssueSchema 类型与枚举非法被拒', () => {
  it('status 非法枚举被拒', () => {
    expectInvalidIssue({ ...cloneIssue(), status: 'closed' })
    expectInvalidIssue({ ...cloneIssue(), status: 'proposed' })
  })
  it('severity 非法枚举被拒', () => {
    expectInvalidIssue({ ...cloneIssue(), severity: 'warn' })
    expectInvalidIssue({ ...cloneIssue(), severity: 'High' })
  })
  it('created_from_task 非法被拒', () => {
    for (const cft of ['TASK-XX', 'SPEC-', 'ARCH', 'random', 'api']) {
      expectInvalidIssue({ ...cloneIssue(), created_from_task: cft })
    }
  })
  it('title / scope / recommended_action 空串被拒', () => {
    expectInvalidIssue({ ...cloneIssue(), title: '' })
    expectInvalidIssue({ ...cloneIssue(), scope: '' })
    expectInvalidIssue({ ...cloneIssue(), recommended_action: '' })
  })
  it('owner 非字符串被拒（但允许空串）', () => {
    expectInvalidIssue({ ...cloneIssue(), owner: null })
    expectInvalidIssue({ ...cloneIssue(), owner: 123 })
  })
  it('字段类型错误被拒', () => {
    expectInvalidIssue({ ...cloneIssue(), severity: 'high ' })
    expectInvalidIssue({ ...cloneIssue(), status: {} })
    expectInvalidIssue({ ...cloneIssue(), recommended_action: [] })
  })
})
