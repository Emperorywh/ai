import { describe, expect, it } from 'vitest'
import {
  ContextPackSchema,
  TaskFrontmatterSchema,
  WorkflowOutputsSchema,
} from '../../../src/core/index.js'

/* -------- 合法正例：基于 Readme.md §9 模板，id 用真实 TASK-003 -------- */

const validFrontmatter = {
  id: 'TASK-003',
  title: 'Core 任务 frontmatter Schema',
  status: 'draft',
  layer: 'type',
  depends_on: ['TASK-002'],
  allowed_paths: ['src/core/schemas/task-schema.ts'],
  forbidden_paths: ['src/application'],
  permissions: [],
  no_review: false,
  restart_on_retry: false,
  verification: ['npm run typecheck', 'npm test -- core/schemas/task-schema'],
  context_pack: {
    required_docs: ['AGENTS.md', 'docs/ARCHITECTURE.md', 'docs/PROGRESS.md'],
    optional_doc_excerpts: ['Readme.md#9-任务文件模板'],
    source_files: ['src/core/enums.ts'],
  },
  workflow_outputs: {
    result_file: 'docs/tasks/TASK-003-core-task-schema.result.md',
  },
}

/* -------- 校验辅助：保持 core 测试零反向依赖，仅依赖 safeParse 结构 -------- */

type Obj = Record<string, unknown>

/** 纯数据深拷贝（validFrontmatter 无函数 / 循环引用，JSON 拷贝足够）。 */
function clone(): Obj {
  return JSON.parse(JSON.stringify(validFrontmatter)) as Obj
}

/** 返回删除指定顶层字段后的副本，用于「缺必填字段被拒」用例。 */
function omitKey(obj: Obj, key: string): Obj {
  const copy: Obj = { ...obj }
  delete copy[key]
  return copy
}

/** 期望通过校验；失败时把 zod issues 打进断言信息，便于定位。 */
function expectValid(sample: unknown): void {
  const result = TaskFrontmatterSchema.safeParse(sample)
  expect(
    result.success,
    result.success ? '' : JSON.stringify(result.error.issues),
  ).toBe(true)
}

/** 期望被校验拒绝。 */
function expectInvalid(sample: unknown): void {
  expect(TaskFrontmatterSchema.safeParse(sample).success).toBe(false)
}

/* -------- 正例 -------- */

describe('TaskFrontmatterSchema 正例', () => {
  it('Readme §9 模板形态（真实 id）通过', () => {
    expectValid(validFrontmatter)
  })

  it('缺省字段取默认值：depends_on / forbidden_paths / permissions / 布尔', () => {
    const minimal = clone()
    delete minimal.depends_on
    delete minimal.forbidden_paths
    delete minimal.permissions
    delete minimal.no_review
    delete minimal.restart_on_retry
    const parsed = TaskFrontmatterSchema.safeParse(minimal)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.depends_on).toEqual([])
      expect(parsed.data.forbidden_paths).toEqual([])
      expect(parsed.data.permissions).toEqual([])
      expect(parsed.data.no_review).toBe(false)
      expect(parsed.data.restart_on_retry).toBe(false)
    }
  })

  it('context_pack 三子字段允许空数组（§8 裁剪规则）', () => {
    expectValid({
      ...clone(),
      context_pack: { required_docs: [], optional_doc_excerpts: [], source_files: [] },
    })
  })

  it('allowed_paths / verification 允许空数组', () => {
    const sample = clone()
    sample.allowed_paths = []
    sample.verification = []
    expectValid(sample)
  })

  it('status 接受全部合法 TaskStatus（不强制初值，任务 §8）', () => {
    for (const status of ['draft', 'ready', 'running', 'reviewing', 'done', 'rejected', 'failed', 'blocked', 'cancelled']) {
      expectValid({ ...clone(), status })
    }
  })

  it('depends_on 引用其它真实任务 id 通过', () => {
    expectValid({ ...clone(), depends_on: ['TASK-001', 'TASK-002'] })
  })
})

/* -------- 缺必填字段被拒（§11 验收） -------- */

describe('TaskFrontmatterSchema 缺必填字段被拒', () => {
  const requiredKeys = [
    'id', 'title', 'status', 'layer',
    'allowed_paths', 'verification', 'context_pack', 'workflow_outputs',
  ] as const
  for (const key of requiredKeys) {
    it(`缺 ${key} 被拒`, () => {
      expectInvalid(omitKey(clone(), key))
    })
  }
})

/* -------- 类型错误 / 非法枚举被拒（§11 验收） -------- */

describe('TaskFrontmatterSchema 类型与枚举非法被拒', () => {
  it('id 非法格式被拒（复用 TaskIdSchema）', () => {
    for (const id of ['TASK-XX', 'task-001', 'TASK-', '001', 'TASK-003-2', '']) {
      expectInvalid({ ...clone(), id })
    }
  })
  it('title 非字符串或空串被拒', () => {
    expectInvalid({ ...clone(), title: 123 })
    expectInvalid({ ...clone(), title: '' })
  })
  it('status / layer 非法枚举被拒', () => {
    expectInvalid({ ...clone(), status: 'pending' })
    expectInvalid({ ...clone(), layer: 'business' })
  })
  it('permissions 含非法枚举被拒', () => {
    expectInvalid({ ...clone(), permissions: ['read_files', 'exec'] })
  })
  it('depends_on 含非法任务 id 被拒', () => {
    expectInvalid({ ...clone(), depends_on: ['TASK-002', 'bad-id'] })
  })
  it('数组字段类型错误被拒', () => {
    expectInvalid({ ...clone(), allowed_paths: 'src/x' })
    expectInvalid({ ...clone(), verification: 'npm test' })
  })
  it('布尔字段类型错误被拒', () => {
    expectInvalid({ ...clone(), no_review: 'yes' })
    expectInvalid({ ...clone(), restart_on_retry: 1 })
  })
})

/* -------- ContextPackSchema 结构校验 -------- */

describe('ContextPackSchema 结构校验', () => {
  const validPack = {
    required_docs: ['AGENTS.md'],
    optional_doc_excerpts: [],
    source_files: [],
  }
  it('合法结构通过', () => {
    expect(ContextPackSchema.safeParse(validPack).success).toBe(true)
  })
  it('缺任一子字段被拒', () => {
    for (const key of ['required_docs', 'optional_doc_excerpts', 'source_files']) {
      const copy: Obj = { ...validPack }
      delete copy[key]
      expect(ContextPackSchema.safeParse(copy).success).toBe(false)
    }
  })
  it('子字段非数组被拒', () => {
    expect(
      ContextPackSchema.safeParse({ ...validPack, required_docs: 'AGENTS.md' }).success,
    ).toBe(false)
  })
  it('frontmatter 中 context_pack 非对象被拒', () => {
    expectInvalid({ ...clone(), context_pack: [] })
    expectInvalid({ ...clone(), context_pack: null })
  })
})

/* -------- WorkflowOutputsSchema result_file 必填 -------- */

describe('WorkflowOutputsSchema result_file 必填', () => {
  it('合法 result_file 通过', () => {
    expect(
      WorkflowOutputsSchema.safeParse({ result_file: 'docs/tasks/TASK-003-x.result.md' }).success,
    ).toBe(true)
  })
  it('缺 result_file / 空串 / 非字符串被拒', () => {
    expect(WorkflowOutputsSchema.safeParse({}).success).toBe(false)
    expect(WorkflowOutputsSchema.safeParse({ result_file: '' }).success).toBe(false)
    expect(WorkflowOutputsSchema.safeParse({ result_file: 123 }).success).toBe(false)
  })
  it('frontmatter 缺 workflow_outputs 被拒', () => {
    expectInvalid(omitKey(clone(), 'workflow_outputs'))
  })
})
