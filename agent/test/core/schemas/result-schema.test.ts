import { describe, expect, it } from 'vitest'
import {
  ExecutionCommitSchema,
  GlobalUpdateRequestsSchema,
  ProgressUpdateRequestSchema,
  ResultFrontmatterSchema,
  ResultVerificationSchema,
} from '../../../src/core/index.js'

/* -------- 合法正例：基于 Readme.md §10 模板，task_id 用真实 TASK-005 -------- */

/**
 * 执行结果正例：覆盖 §10 frontmatter 全部机器字段。
 * - execution_commits 为 []（Executor 提议态，由 Orchestrator 回填）。
 * - global_update_requests 三子项各给一条最小结构项（progress / decision / issue），
 *   decision / issue 的 id 留空（提议态，Orchestrator 回写分配）。
 */
const validResult = {
  task_id: 'TASK-005',
  execution_status: 'completed',
  modified_files: ['src/core/index.ts'],
  created_files: ['src/core/schemas/result-schema.ts'],
  deleted_files: [],
  execution_commits: [],
  verification: [
    { command: 'npm run typecheck', result: 'passed', notes: '' },
  ],
  global_update_requests: {
    progress: [
      {
        section: '当前完成到哪个任务',
        mode: 'replace',
        content: 'TASK-005 已完成 Result Schema',
      },
    ],
    decisions: [
      {
        id: '',
        title: 'execution_commits 元素结构锁定为 hash/message/author/time',
        status: 'proposed',
        scope: 'core',
        decision: '在 ResultFrontmatterSchema 内定义 ExecutionCommitSchema 四元组。',
        rationale: '§3.2 / §10 明确执行 commit 元信息为 hash/message/author/time。',
        consequences: '后续 Orchestrator 回填须提供完整四元组。',
        created_from_task: 'TASK-005',
      },
    ],
    issues: [
      {
        id: '',
        title: 'verification.result 枚举暂定义于本文件',
        status: 'open',
        severity: 'low',
        scope: 'core',
        owner: '',
        recommended_action: '后续若被其他层复用，提升至 enums.ts。',
        created_from_task: 'TASK-005',
      },
    ],
  },
  next_action: 'review',
}

/* -------- 校验辅助：保持 core 测试零反向依赖，仅依赖 safeParse 结构 -------- */

type Obj = Record<string, unknown>

/** 纯数据深拷贝（validResult 无函数 / 循环引用，JSON 拷贝足够）。 */
function clone(): Obj {
  return JSON.parse(JSON.stringify(validResult)) as Obj
}

/** 返回删除指定顶层字段后的副本，用于「缺必填字段被拒」用例。 */
function omit(obj: Obj, key: string): Obj {
  const copy: Obj = { ...obj }
  delete copy[key]
  return copy
}

/** 期望 ResultFrontmatterSchema 通过；失败时把 zod issues 打进断言信息，便于定位。 */
function expectValid(sample: unknown): void {
  const result = ResultFrontmatterSchema.safeParse(sample)
  expect(
    result.success,
    result.success ? '' : JSON.stringify(result.error.issues),
  ).toBe(true)
}
function expectInvalid(sample: unknown): void {
  expect(ResultFrontmatterSchema.safeParse(sample).success).toBe(false)
}

/* ============================================================ *
 * ResultFrontmatterSchema 正例（§11 验收：§10 正例通过）
 * ============================================================ */

describe('ResultFrontmatterSchema 正例', () => {
  it('§10 模板形态通过', () => {
    expectValid(validResult)
  })

  it('全空产物（数组 / 三子项皆空）通过', () => {
    expectValid({
      ...clone(),
      modified_files: [],
      created_files: [],
      deleted_files: [],
      verification: [],
      global_update_requests: { progress: [], decisions: [], issues: [] },
    })
  })

  it('execution_commits 缺失时取默认 []（§10 / 任务 §8）', () => {
    const withoutCommits = clone()
    delete withoutCommits.execution_commits
    expectValid(withoutCommits)
  })

  it('execution_status 接受 completed / blocked / failed', () => {
    for (const status of ['completed', 'blocked', 'failed']) {
      expectValid({ ...clone(), execution_status: status })
    }
  })

  it('next_action 接受 review / retry / needs-human / cancel', () => {
    for (const action of ['review', 'retry', 'needs-human', 'cancel']) {
      expectValid({ ...clone(), next_action: action })
    }
  })

  it('verification[].result 接受 passed / failed / skipped', () => {
    for (const result of ['passed', 'failed', 'skipped']) {
      expectValid({
        ...clone(),
        verification: [{ command: 'npm test', result, notes: '' }],
      })
    }
  })

  it('progress mode 接受 replace / append', () => {
    for (const mode of ['replace', 'append']) {
      expectValid({
        ...clone(),
        global_update_requests: {
          progress: [{ section: '建议下一个任务', mode, content: 'TASK-006' }],
          decisions: [],
          issues: [],
        },
      })
    }
  })

  it('task_id 接受任意 TASK-\\d+', () => {
    for (const id of ['TASK-005', 'TASK-1', 'TASK-100']) {
      expectValid({ ...clone(), task_id: id })
    }
  })
})

/* ============================================================ *
 * execution_status × next_action 组合不在 Schema 层硬拒（§11 / §12 风险点）
 * ============================================================ */

describe('execution_status × next_action 非法组合不在 Schema 层硬拒', () => {
  // §10 明确为非法组合（completed+retry / blocked+review / failed+review），
  // 但其合法性由 TASK-008 状态映射在运行期判定，Schema 只校验单字段枚举。
  it('completed + retry（非法组合）Schema 层仍通过', () => {
    expectValid({ ...clone(), execution_status: 'completed', next_action: 'retry' })
  })
  it('blocked + review（非法组合）Schema 层仍通过', () => {
    expectValid({ ...clone(), execution_status: 'blocked', next_action: 'review' })
  })
  it('failed + review（非法组合）Schema 层仍通过', () => {
    expectValid({ ...clone(), execution_status: 'failed', next_action: 'review' })
  })
})

/* ============================================================ *
 * 缺必填字段被拒（§11 验收）
 * ============================================================ */

describe('ResultFrontmatterSchema 缺必填字段被拒', () => {
  // execution_commits 有 .default([])，缺失不拒；其余顶层字段必填。
  const requiredKeys = [
    'task_id',
    'execution_status',
    'modified_files',
    'created_files',
    'deleted_files',
    'verification',
    'global_update_requests',
    'next_action',
  ] as const
  for (const key of requiredKeys) {
    it(`缺 ${key} 被拒`, () => {
      expectInvalid(omit(clone(), key))
    })
  }

  it('global_update_requests 缺 progress 子项被拒', () => {
    const gur = clone().global_update_requests as Obj
    delete gur.progress
    expectInvalid({ ...clone(), global_update_requests: gur })
  })
  it('global_update_requests 缺 decisions 子项被拒', () => {
    const gur = clone().global_update_requests as Obj
    delete gur.decisions
    expectInvalid({ ...clone(), global_update_requests: gur })
  })
  it('global_update_requests 缺 issues 子项被拒', () => {
    const gur = clone().global_update_requests as Obj
    delete gur.issues
    expectInvalid({ ...clone(), global_update_requests: gur })
  })
})

/* ============================================================ *
 * 单字段枚举与类型非法被拒
 * ============================================================ */

describe('ResultFrontmatterSchema 单字段枚举与类型非法被拒', () => {
  it('execution_status 非法枚举被拒', () => {
    expectInvalid({ ...clone(), execution_status: 'done' })
    expectInvalid({ ...clone(), execution_status: 'success' })
  })
  it('next_action 非法枚举被拒', () => {
    expectInvalid({ ...clone(), next_action: 'approve' })
    expectInvalid({ ...clone(), next_action: 'proceed' })
  })
  it('task_id 非法（非 TASK-\\d+）被拒', () => {
    for (const id of ['TASK-XX', 'task-005', 'TASK-', '005', 'TASK-05a']) {
      expectInvalid({ ...clone(), task_id: id })
    }
  })
  it('verification[].result 非法枚举被拒', () => {
    expectInvalid({
      ...clone(),
      verification: [{ command: 'npm test', result: 'ok', notes: '' }],
    })
    expectInvalid({
      ...clone(),
      verification: [{ command: 'npm test', result: 'success', notes: '' }],
    })
  })
  it('verification[].command 空串被拒', () => {
    expectInvalid({
      ...clone(),
      verification: [{ command: '', result: 'passed', notes: '' }],
    })
  })
  it('文件数组字段类型错误被拒', () => {
    expectInvalid({ ...clone(), modified_files: 'src/core/index.ts' })
    expectInvalid({ ...clone(), created_files: [123] })
    expectInvalid({ ...clone(), deleted_files: null })
  })
})

/* ============================================================ *
 * progress 项结构（§11 验收：缺 mode 被拒；mode 非 replace/append 被拒）
 * ============================================================ */

describe('progress 项 { section, mode, content } 结构', () => {
  it('§10 最小结构通过', () => {
    expect(
      ProgressUpdateRequestSchema.safeParse({
        section: '当前完成到哪个任务',
        mode: 'replace',
        content: 'TASK-005 已完成',
      }).success,
    ).toBe(true)
  })

  it('缺 mode 被拒（§11 验收）', () => {
    const item: Obj = { section: '建议下一个任务', content: 'TASK-006' }
    expect(ProgressUpdateRequestSchema.safeParse(item).success).toBe(false)
  })

  it('mode 非 replace / append 被拒（§11 验收）', () => {
    for (const mode of ['overwrite', 'merge', 'REPLACE', '', 'update']) {
      expect(
        ProgressUpdateRequestSchema.safeParse({
          section: '建议下一个任务',
          mode,
          content: 'TASK-006',
        }).success,
      ).toBe(false)
    }
  })

  it('缺 section / content 被拒', () => {
    expect(
      ProgressUpdateRequestSchema.safeParse({ mode: 'append', content: 'x' }).success,
    ).toBe(false)
    expect(
      ProgressUpdateRequestSchema.safeParse({ section: 'x', mode: 'append' }).success,
    ).toBe(false)
  })

  it('section / content 空串被拒', () => {
    expect(
      ProgressUpdateRequestSchema.safeParse({ section: '', mode: 'replace', content: 'x' })
        .success,
    ).toBe(false)
    expect(
      ProgressUpdateRequestSchema.safeParse({ section: 'x', mode: 'replace', content: '' })
        .success,
    ).toBe(false)
  })

  it('progress 非法项在整体 frontmatter 中被拒', () => {
    expectInvalid({
      ...clone(),
      global_update_requests: {
        progress: [{ section: '建议下一个任务', mode: 'overwrite', content: 'TASK-006' }],
        decisions: [],
        issues: [],
      },
    })
  })
})

/* ============================================================ *
 * decisions / issues 复用 TASK-004 字段集（id 允许空）
 * ============================================================ */

describe('global_update_requests.decisions / issues 复用 TASK-004 字段集', () => {
  it('decisions id 留空（提议态）通过', () => {
    expectValid({
      ...clone(),
      global_update_requests: {
        progress: [],
        decisions: [
          {
            id: '',
            title: '提议决策',
            status: 'proposed',
            scope: 'core',
            decision: 'd',
            rationale: 'r',
            consequences: 'c',
            created_from_task: 'TASK-005',
          },
        ],
        issues: [],
      },
    })
  })

  it('issues id / owner 留空（提议态）通过', () => {
    expectValid({
      ...clone(),
      global_update_requests: {
        progress: [],
        decisions: [],
        issues: [
          {
            id: '',
            title: '提议问题',
            status: 'open',
            severity: 'medium',
            scope: 'core',
            owner: '',
            recommended_action: 'a',
            created_from_task: 'TASK-005',
          },
        ],
      },
    })
  })

  it('decisions 缺必填字段（缺 rationale）在整体中被拒', () => {
    const decision: Obj = {
      id: '',
      title: 't',
      status: 'proposed',
      scope: 'core',
      decision: 'd',
      // 缺 rationale
      consequences: 'c',
      created_from_task: 'TASK-005',
    }
    expectInvalid({
      ...clone(),
      global_update_requests: { progress: [], decisions: [decision], issues: [] },
    })
  })

  it('issues 缺必填字段（缺 severity）在整体中被拒', () => {
    const issue: Obj = {
      id: '',
      title: 't',
      status: 'open',
      // 缺 severity
      scope: 'core',
      owner: '',
      recommended_action: 'a',
      created_from_task: 'TASK-005',
    }
    expectInvalid({
      ...clone(),
      global_update_requests: { progress: [], decisions: [], issues: [issue] },
    })
  })

  it('GlobalUpdateRequestsSchema 三子项皆空通过', () => {
    expect(
      GlobalUpdateRequestsSchema.safeParse({
        progress: [],
        decisions: [],
        issues: [],
      }).success,
    ).toBe(true)
  })
})

/* ============================================================ *
 * execution_commits 元素结构（§3.2 / §10：hash/message/author/time）
 * ============================================================ */

describe('execution_commits 元素结构', () => {
  it('完整四元组通过', () => {
    expect(
      ExecutionCommitSchema.safeParse({
        hash: 'abc1234',
        message: 'feat: 实现 Result Schema',
        author: 'executor',
        time: '2026-07-08T10:00:00Z',
      }).success,
    ).toBe(true)
  })

  it('缺四元组任一字段被拒', () => {
    for (const key of ['hash', 'message', 'author', 'time']) {
      const item: Obj = {
        hash: 'abc1234',
        message: 'm',
        author: 'a',
        time: '2026-07-08T10:00:00Z',
      }
      delete item[key]
      expect(ExecutionCommitSchema.safeParse(item).success).toBe(false)
    }
  })

  it('带完整 execution_commits 元素的整体 frontmatter 通过', () => {
    expectValid({
      ...clone(),
      execution_commits: [
        {
          hash: 'abc1234',
          message: 'feat: 实现 Result Schema(TASK-005)',
          author: 'Task Executor',
          time: '2026-07-08T10:00:00Z',
        },
      ],
    })
  })

  it('execution_commits 元素缺字段在整体中被拒', () => {
    expectInvalid({
      ...clone(),
      execution_commits: [{ hash: 'abc1234', message: 'm', author: 'a' }],
    })
  })
})

/* ============================================================ *
 * verification 条目结构
 * ============================================================ */

describe('verification 条目 { command, result, notes } 结构', () => {
  it('§10 最小结构通过', () => {
    expect(
      ResultVerificationSchema.safeParse({
        command: 'npm run typecheck',
        result: 'passed',
        notes: '',
      }).success,
    ).toBe(true)
  })

  it('缺 command / result 被拒', () => {
    expect(
      ResultVerificationSchema.safeParse({ result: 'passed', notes: '' }).success,
    ).toBe(false)
    expect(
      ResultVerificationSchema.safeParse({ command: 'npm test', notes: '' }).success,
    ).toBe(false)
  })

  it('缺 notes 被拒（必填，允许空串）', () => {
    expect(
      ResultVerificationSchema.safeParse({ command: 'npm test', result: 'passed' }).success,
    ).toBe(false)
  })
})
