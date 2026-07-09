import { describe, expect, it } from 'vitest'
import {
  computeContextPack,
  refreshSourceFiles,
  type DependencyResultSummary,
} from '../../src/application/index.js'
import type { TaskFrontmatter, TaskId } from '../../src/core/index.js'

/* ============================================================ *
 * 测试夹具
 * ============================================================ */

/**
 * 构造一份合法 TaskFrontmatter，按需覆盖与本模块相关的字段。
 *
 * 其余字段（title / status / layer / allowed_paths 等）用安全默认值填充，
 * 聚焦 context_pack / workflow_outputs / depends_on 三个本模块关心的维度。
 */
function makeTask(
  overrides: {
    id?: TaskId
    depends_on?: TaskId[]
    required_docs?: string[]
    optional_doc_excerpts?: string[]
    source_files?: string[]
    result_file?: string
  } = {},
): TaskFrontmatter {
  return {
    id: overrides.id ?? 'TASK-015',
    title: '测试任务',
    status: 'ready',
    layer: 'domain',
    depends_on: overrides.depends_on ?? [],
    allowed_paths: [],
    forbidden_paths: [],
    permissions: [],
    no_review: false,
    restart_on_retry: false,
    verification: [],
    context_pack: {
      required_docs: overrides.required_docs ?? [],
      optional_doc_excerpts: overrides.optional_doc_excerpts ?? [],
      source_files: overrides.source_files ?? [],
    },
    workflow_outputs: {
      result_file: overrides.result_file ?? 'docs/tasks/TASK-015-test.result.md',
    },
  }
}

/** 构造一份依赖结果摘要（modified / created 任选）。 */
function makeDepResult(
  taskId: TaskId,
  files: { modified?: readonly string[]; created?: readonly string[] } = {},
): DependencyResultSummary {
  return {
    task_id: taskId,
    modified_files: files.modified ?? [],
    created_files: files.created ?? [],
  }
}

/** 必读核心三件套（§8），供断言「恒在」复用。 */
const CORE_DOCS = ['AGENTS.md', 'docs/ARCHITECTURE.md', 'docs/PROGRESS.md']

/* ============================================================ *
 * computeContextPack：必读核心与并集规则
 * ============================================================ */

describe('computeContextPack：必读核心恒在', () => {
  it('frontmatter 省略必读核心时仍补齐三件套 + 当前任务文件', () => {
    const task = makeTask({ required_docs: [] })
    const pack = computeContextPack(task, { dependencyResults: new Map() })
    // 必读核心三件套恒在。
    for (const doc of CORE_DOCS) {
      expect(pack.required_docs).toContain(doc)
    }
    // 当前任务文件按 result_file 派生并入（TASK-015-test.result.md → ...-test.md）。
    expect(pack.required_docs).toContain('docs/tasks/TASK-015-test.md')
  })

  it('当前任务文件不计入 frontmatter required_docs，但在清单中并入', () => {
    // frontmatter required_docs 不含任务文件本身（§8），computeContextPack 仍并入。
    const task = makeTask({
      required_docs: ['docs/TESTING.md'],
      result_file: 'docs/tasks/TASK-015-foo.result.md',
    })
    const pack = computeContextPack(task, { dependencyResults: new Map() })
    expect(pack.required_docs).toContain('docs/tasks/TASK-015-foo.md')
    expect(pack.required_docs).toContain('docs/TESTING.md')
  })

  it('frontmatter 已声明必读核心时不重复（去重）', () => {
    const task = makeTask({
      required_docs: ['AGENTS.md', 'docs/PROGRESS.md'],
    })
    const pack = computeContextPack(task, { dependencyResults: new Map() })
    const agentsCount = pack.required_docs.filter((d) => d === 'AGENTS.md').length
    expect(agentsCount).toBe(1)
  })

  it('required_docs 含任务文件路径时去重不重复', () => {
    // 防御性：即便 frontmatter 误把任务文件列入 required_docs，清单不重复。
    const task = makeTask({
      required_docs: ['docs/tasks/TASK-015-test.md'],
    })
    const pack = computeContextPack(task, { dependencyResults: new Map() })
    const count = pack.required_docs.filter(
      (d) => d === 'docs/tasks/TASK-015-test.md',
    ).length
    expect(count).toBe(1)
  })
})

describe('computeContextPack：optional_doc_excerpts 保留', () => {
  it('声明值原样保留并去重', () => {
    const task = makeTask({
      optional_doc_excerpts: [
        'Readme.md#8-context-pack-上下文包',
        'Readme.md#10-任务执行结果模板',
        'Readme.md#8-context-pack-上下文包', // 重复
      ],
    })
    const pack = computeContextPack(task, { dependencyResults: new Map() })
    expect(pack.optional_doc_excerpts).toEqual([
      'Readme.md#8-context-pack-上下文包',
      'Readme.md#10-任务执行结果模板',
    ])
  })

  it('未声明时为空数组', () => {
    const task = makeTask()
    const pack = computeContextPack(task, { dependencyResults: new Map() })
    expect(pack.optional_doc_excerpts).toEqual([])
  })
})

describe('computeContextPack：任务文件路径派生', () => {
  it('从 result_file 派生任务文件路径（去 .result.md 加 .md）', () => {
    const task = makeTask({ result_file: 'docs/tasks/TASK-003-foo-bar.result.md' })
    const pack = computeContextPack(task, { dependencyResults: new Map() })
    expect(pack.required_docs).toContain('docs/tasks/TASK-003-foo-bar.md')
  })

  it('result_file 不以 .result.md 结尾时抛错（§9 约定）', () => {
    const task = makeTask({ result_file: 'docs/tasks/TASK-015-bad.txt' })
    expect(() =>
      computeContextPack(task, { dependencyResults: new Map() }),
    ).toThrowError(/\.result\.md/)
  })
})

describe('computeContextPack：source_files 随依赖刷新', () => {
  it('依赖全部完成 → source_files = 依赖实际产物并集', () => {
    const task = makeTask({
      depends_on: ['TASK-001', 'TASK-002'],
      source_files: ['prefilled.ts'], // 预填应被替换
    })
    const results = new Map<TaskId, DependencyResultSummary>([
      ['TASK-001', makeDepResult('TASK-001', { modified: ['src/a.ts'] })],
      ['TASK-002', makeDepResult('TASK-002', { created: ['src/b.ts', 'src/c.ts'] })],
    ])
    const pack = computeContextPack(task, { dependencyResults: results })
    expect(pack.source_files.sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  it('依赖未完成 → source_files 保留预填', () => {
    const task = makeTask({
      depends_on: ['TASK-001'],
      source_files: ['prefilled.ts'],
    })
    // TASK-001 未提供结果 → 不刷新。
    const pack = computeContextPack(task, { dependencyResults: new Map() })
    expect(pack.source_files).toEqual(['prefilled.ts'])
  })

  it('无依赖 → source_files 保留预填（无可刷新来源）', () => {
    const task = makeTask({ source_files: ['own.ts'] })
    const pack = computeContextPack(task, { dependencyResults: new Map() })
    expect(pack.source_files).toEqual(['own.ts'])
  })
})

describe('computeContextPack：不扩展范围', () => {
  it('最终清单 ⊆ 候选来源（不引入额外文件）', () => {
    const task = makeTask({
      depends_on: ['TASK-001'],
      required_docs: ['docs/TESTING.md'],
      optional_doc_excerpts: ['Readme.md#8-context-pack-上下文包'],
      source_files: ['prefilled.ts'],
    })
    const results = new Map<TaskId, DependencyResultSummary>([
      ['TASK-001', makeDepResult('TASK-001', { modified: ['src/real.ts'] })],
    ])
    const pack = computeContextPack(task, { dependencyResults: results })

    // required_docs 只含：必读核心 + 任务文件 + 声明值。
    const expectedRequired = new Set([
      ...CORE_DOCS,
      'docs/tasks/TASK-015-test.md',
      'docs/TESTING.md',
    ])
    for (const doc of pack.required_docs) {
      expect(expectedRequired.has(doc)).toBe(true)
    }
    // source_files 刷新后只含依赖实际产物（预填被替换、不残留）。
    expect(pack.source_files).toEqual(['src/real.ts'])
    // optional_doc_excerpts 只含声明值。
    for (const exc of pack.optional_doc_excerpts) {
      expect(['Readme.md#8-context-pack-上下文包'].includes(exc)).toBe(true)
    }
  })
})

/* ============================================================ *
 * refreshSourceFiles：刷新规则
 * ============================================================ */

describe('refreshSourceFiles：全部依赖完成 → 替换为产物并集', () => {
  it('modified + created 合并', () => {
    const task = makeTask({
      depends_on: ['TASK-001'],
      source_files: ['prefilled.ts'],
    })
    const results = new Map<TaskId, DependencyResultSummary>([
      [
        'TASK-001',
        makeDepResult('TASK-001', {
          modified: ['src/a.ts', 'src/b.ts'],
          created: ['src/new.ts'],
        }),
      ],
    ])
    expect(refreshSourceFiles(task, results).sort()).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/new.ts',
    ])
  })

  it('多依赖产物取并集', () => {
    const task = makeTask({
      depends_on: ['TASK-001', 'TASK-002', 'TASK-003'],
      source_files: [],
    })
    const results = new Map<TaskId, DependencyResultSummary>([
      ['TASK-001', makeDepResult('TASK-001', { modified: ['x.ts'] })],
      ['TASK-002', makeDepResult('TASK-002', { created: ['y.ts'] })],
      ['TASK-003', makeDepResult('TASK-003', { modified: ['z.ts'] })],
    ])
    expect(refreshSourceFiles(task, results).sort()).toEqual([
      'x.ts',
      'y.ts',
      'z.ts',
    ])
  })

  it('产物含重复文件时去重', () => {
    // 两个依赖都改了同一文件，并集后只出现一次。
    const task = makeTask({
      depends_on: ['TASK-001', 'TASK-002'],
      source_files: [],
    })
    const results = new Map<TaskId, DependencyResultSummary>([
      ['TASK-001', makeDepResult('TASK-001', { modified: ['shared.ts'] })],
      ['TASK-002', makeDepResult('TASK-002', { modified: ['shared.ts'] })],
    ])
    expect(refreshSourceFiles(task, results)).toEqual(['shared.ts'])
  })

  it('刷新后不含预填 source_files（替换语义）', () => {
    const task = makeTask({
      depends_on: ['TASK-001'],
      source_files: ['prefilled-1.ts', 'prefilled-2.ts'],
    })
    const results = new Map<TaskId, DependencyResultSummary>([
      ['TASK-001', makeDepResult('TASK-001', { created: ['actual.ts'] })],
    ])
    const refreshed = refreshSourceFiles(task, results)
    expect(refreshed).toEqual(['actual.ts'])
    expect(refreshed).not.toContain('prefilled-1.ts')
  })

  it('依赖产物为空时返回空数组', () => {
    const task = makeTask({
      depends_on: ['TASK-001'],
      source_files: ['prefilled.ts'],
    })
    const results = new Map<TaskId, DependencyResultSummary>([
      ['TASK-001', makeDepResult('TASK-001')],
    ])
    expect(refreshSourceFiles(task, results)).toEqual([])
  })
})

describe('refreshSourceFiles：未完成 / 无依赖 → 保留预填', () => {
  it('任一依赖未完成 → 保留预填', () => {
    const task = makeTask({
      depends_on: ['TASK-001', 'TASK-002'],
      source_files: ['prefilled.ts'],
    })
    // 只提供 TASK-001，TASK-002 缺失。
    const results = new Map<TaskId, DependencyResultSummary>([
      ['TASK-001', makeDepResult('TASK-001', { modified: ['src/a.ts'] })],
    ])
    expect(refreshSourceFiles(task, results)).toEqual(['prefilled.ts'])
  })

  it('全部依赖均未提供 → 保留预填', () => {
    const task = makeTask({
      depends_on: ['TASK-001'],
      source_files: ['prefilled.ts'],
    })
    expect(refreshSourceFiles(task, new Map())).toEqual(['prefilled.ts'])
  })

  it('无依赖（depends_on 为空）→ 保留预填', () => {
    const task = makeTask({
      depends_on: [],
      source_files: ['own-a.ts', 'own-b.ts'],
    })
    expect(refreshSourceFiles(task, new Map())).toEqual(['own-a.ts', 'own-b.ts'])
  })

  it('无依赖且预填为空 → 返回空数组', () => {
    const task = makeTask({ depends_on: [], source_files: [] })
    expect(refreshSourceFiles(task, new Map())).toEqual([])
  })
})
