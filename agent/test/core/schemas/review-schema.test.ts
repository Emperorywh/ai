import { describe, expect, it } from 'vitest'
import { ReviewFrontmatterSchema } from '../../../src/core/index.js'

/* -------- 合法正例：基于 Readme.md §15 模板，task_id 用真实 TASK-006 -------- */

/**
 * 审查结论正例：覆盖 §15 frontmatter 全部机器字段。
 * - review_result 为 approved（常态通过），required_changes / findings 为空。
 */
const validReview = {
  task_id: 'TASK-006',
  review_result: 'approved',
  reviewer: 'reviewer-agent',
  reviewed_at: '2026-07-07T00:00:00Z',
  required_changes: [],
  findings: [],
}

/* -------- 校验辅助：保持 core 测试零反向依赖，仅依赖 safeParse 结构 -------- */

type Obj = Record<string, unknown>

/** 纯数据深拷贝（validReview 无函数 / 循环引用，JSON 拷贝足够）。 */
function clone(): Obj {
  return JSON.parse(JSON.stringify(validReview)) as Obj
}

/** 返回删除指定顶层字段后的副本，用于「缺必填字段被拒」用例。 */
function omit(obj: Obj, key: string): Obj {
  const copy: Obj = { ...obj }
  delete copy[key]
  return copy
}

/** 期望 ReviewFrontmatterSchema 通过；失败时把 zod issues 打进断言信息，便于定位。 */
function expectValid(sample: unknown): void {
  const result = ReviewFrontmatterSchema.safeParse(sample)
  expect(
    result.success,
    result.success ? '' : JSON.stringify(result.error.issues),
  ).toBe(true)
}
function expectInvalid(sample: unknown): void {
  expect(ReviewFrontmatterSchema.safeParse(sample).success).toBe(false)
}

/* ============================================================ *
 * ReviewFrontmatterSchema 正例（§11 验收：§15 正例通过）
 * ============================================================ */

describe('ReviewFrontmatterSchema 正例', () => {
  it('§15 模板形态（approved，空 required_changes / findings）通过', () => {
    expectValid(validReview)
  })

  it('required_changes / findings 各带多条字符串通过', () => {
    expectValid({
      ...clone(),
      review_result: 'rejected',
      required_changes: ['补全 §15 正例', '修正 reviewed_at 格式'],
      findings: ['发现 A', '发现 B'],
    })
  })

  it('review_result 接受 approved / rejected / needs-human-confirmation / skipped', () => {
    for (const result of [
      'approved',
      'rejected',
      'needs-human-confirmation',
      'skipped',
    ]) {
      expectValid({ ...clone(), review_result: result })
    }
  })

  it('skipped 占位审查（no_review: true，Orchestrator 生成）通过（§15）', () => {
    expectValid({
      ...clone(),
      review_result: 'skipped',
      reviewer: 'orchestrator',
      required_changes: [],
      findings: [],
    })
  })

  it('task_id 接受任意 TASK-\\d+', () => {
    for (const id of ['TASK-006', 'TASK-1', 'TASK-100']) {
      expectValid({ ...clone(), task_id: id })
    }
  })

  it('reviewed_at 合法 ISO8601 UTC（含 / 不含毫秒）通过', () => {
    expectValid({ ...clone(), reviewed_at: '2026-07-08T12:34:56Z' })
    expectValid({ ...clone(), reviewed_at: '2026-07-08T12:34:56.789Z' })
  })
})

/* ============================================================ *
 * 非法 review_result 被拒（§11 验收）
 * ============================================================ */

describe('ReviewFrontmatterSchema 非法 review_result 被拒', () => {
  it('非法枚举被拒', () => {
    for (const result of [
      'approve',
      'pass',
      'ok',
      'ACCEPTED',
      '',
      'needs_human_confirmation', // 下划线变体非法
    ]) {
      expectInvalid({ ...clone(), review_result: result })
    }
  })
})

/* ============================================================ *
 * 非法 reviewed_at 被拒（§11 验收）
 * ============================================================ */

describe('ReviewFrontmatterSchema 非法 reviewed_at 被拒', () => {
  it('非 ISO8601 UTC 格式被拒', () => {
    for (const ts of [
      '2026-07-07', // 仅日期
      '2026/07/07T00:00:00Z', // 斜杠分隔
      '2026-07-07 00:00:00', // 空格分隔、无时区
      '2026-07-07T00:00:00', // 无 UTC 标记
      '20260707T000000Z', // 无分隔符
      'not-a-date',
      '',
    ]) {
      expectInvalid({ ...clone(), reviewed_at: ts })
    }
  })
})

/* ============================================================ *
 * 缺必填字段被拒（§11 验收）
 * ============================================================ */

describe('ReviewFrontmatterSchema 缺必填字段被拒', () => {
  const requiredKeys = [
    'task_id',
    'review_result',
    'reviewer',
    'reviewed_at',
    'required_changes',
    'findings',
  ] as const
  for (const key of requiredKeys) {
    it(`缺 ${key} 被拒`, () => {
      expectInvalid(omit(clone(), key))
    })
  }
})

/* ============================================================ *
 * 单字段类型非法被拒
 * ============================================================ */

describe('ReviewFrontmatterSchema 单字段类型非法被拒', () => {
  it('task_id 非法（非 TASK-\\d+）被拒', () => {
    for (const id of ['TASK-XX', 'task-006', 'TASK-', '006', 'TASK-06a']) {
      expectInvalid({ ...clone(), task_id: id })
    }
  })

  it('reviewer 空串被拒', () => {
    expectInvalid({ ...clone(), reviewer: '' })
  })

  it('required_changes 类型错误被拒', () => {
    expectInvalid({ ...clone(), required_changes: '补全正例' })
    expectInvalid({ ...clone(), required_changes: [123] })
    expectInvalid({ ...clone(), required_changes: null })
  })

  it('findings 类型错误被拒', () => {
    expectInvalid({ ...clone(), findings: '发现 A' })
    expectInvalid({ ...clone(), findings: [true] })
  })
})

/* ============================================================ *
 * §12 风险点软约束：approved / skipped 时 required_changes 应为空
 * —— 不在 Schema 层硬拒，保留弹性（§12）
 * ============================================================ */

describe('§12 软约束：approved / skipped 时 required_changes 应为空（不硬拒）', () => {
  // §12 明确：required_changes 在 approved / skipped 时应为空属软约束，
  // 不强制 Schema 拒绝，保留弹性；合法性由上层编排（TASK-017）约束。
  it('approved + 非空 required_changes Schema 层仍通过', () => {
    expectValid({
      ...clone(),
      review_result: 'approved',
      required_changes: ['本应留空但 Schema 不硬拒'],
    })
  })

  it('skipped + 非空 required_changes Schema 层仍通过', () => {
    expectValid({
      ...clone(),
      review_result: 'skipped',
      required_changes: ['本应留空但 Schema 不硬拒'],
    })
  })
})
