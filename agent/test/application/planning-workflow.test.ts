import { describe, expect, it } from 'vitest'
import {
  createPlanDraft,
  createTaskDrafts,
  renderPlanMarkdown,
  validatePlanningInputs,
  validateTaskGraph,
  type PlanDraftInput,
  type TaskDraftSpec,
} from '../../src/application/index.js'
import type { TaskFrontmatter, TaskId } from '../../src/core/index.js'

/* ============================================================ *
 * 夹具
 * ============================================================ */

/**
 * 构造一份合法 TaskFrontmatter（validateTaskGraph 用），按需覆盖关键维度。
 *
 * 其余字段用安全默认值填充，聚焦 id / depends_on / allowed_paths（任务图校验关心）。
 */
function makeFrontmatter(
  overrides: {
    id?: TaskId
    depends_on?: TaskId[]
    allowed_paths?: string[]
  } = {},
): TaskFrontmatter {
  return {
    id: overrides.id ?? 'TASK-001',
    title: '测试任务',
    status: 'draft',
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
      result_file: `docs/tasks/${overrides.id ?? 'TASK-001'}-x.result.md`,
    },
  }
}

/** 构造一份任务草案 spec，按需覆盖关键字段。 */
function makeSpec(
  overrides: Partial<TaskDraftSpec> & { id: TaskId },
): TaskDraftSpec {
  return {
    title: `${overrides.id} 任务`,
    layer: 'domain',
    allowed_paths: [],
    verification: ['npm run typecheck'],
    result_file: `docs/tasks/${overrides.id}-x.result.md`,
    ...overrides,
  }
}

/* ============================================================ *
 * validatePlanningInputs
 * ============================================================ */

describe('validatePlanningInputs', () => {
  it('SPEC + ARCHITECTURE 均存在且已审查 → standard mode', () => {
    const result = validatePlanningInputs({
      specExists: true,
      architectureExists: true,
      specReviewed: true,
      architectureReviewed: true,
    })
    expect(result).toEqual({ ok: true, mode: 'standard' })
  })

  it('标准前置全满足时，即便声明 sourceSpec 也走 standard（标准优先）', () => {
    const result = validatePlanningInputs({
      specExists: true,
      architectureExists: true,
      specReviewed: true,
      architectureReviewed: true,
      sourceSpec: 'Readme.md',
    })
    expect(result).toEqual({ ok: true, mode: 'standard' })
  })

  it('缺 SPEC/ARCHITECTURE 但声明 sourceSpec → bootstrap + needsHumanConfirmation', () => {
    const result = validatePlanningInputs({
      specExists: false,
      architectureExists: false,
      specReviewed: false,
      architectureReviewed: false,
      sourceSpec: 'Readme.md',
    })
    expect(result).toEqual({
      ok: true,
      mode: 'bootstrap',
      sourceSpec: 'Readme.md',
      needsHumanConfirmation: true,
    })
  })

  it('SPEC 存在但未审查 + sourceSpec → bootstrap（source_spec 兜底）', () => {
    const result = validatePlanningInputs({
      specExists: true,
      architectureExists: true,
      specReviewed: false,
      architectureReviewed: false,
      sourceSpec: 'Readme.md',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.mode).toBe('bootstrap')
  })

  it('缺 SPEC/ARCHITECTURE 且未声明 sourceSpec → 拒绝 + missing 清单', () => {
    const result = validatePlanningInputs({
      specExists: false,
      architectureExists: false,
      specReviewed: false,
      architectureReviewed: false,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toContain('docs/SPEC.md 不存在')
      expect(result.missing).toContain('docs/ARCHITECTURE.md 不存在')
    }
  })

  it('SPEC 存在未审查且无 sourceSpec → 拒绝，missing 含未通过审查项', () => {
    const result = validatePlanningInputs({
      specExists: true,
      architectureExists: true,
      specReviewed: false,
      architectureReviewed: false,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toContain('docs/SPEC.md 未通过审查')
      expect(result.missing).toContain('docs/ARCHITECTURE.md 未通过审查')
      // 存在的文档不报「不存在」。
      expect(result.missing).not.toContain('docs/SPEC.md 不存在')
    }
  })

  it('空白 sourceSpec 视为未声明（非自举）', () => {
    const empty = validatePlanningInputs({
      specExists: false,
      architectureExists: false,
      specReviewed: false,
      architectureReviewed: false,
      sourceSpec: '   ',
    })
    expect(empty.ok).toBe(false)

    const valid = validatePlanningInputs({
      specExists: false,
      architectureExists: false,
      specReviewed: false,
      architectureReviewed: false,
      sourceSpec: '  Readme.md  ',
    })
    expect(valid.ok).toBe(true)
    if (valid.ok && valid.mode === 'bootstrap') {
      // trim 后写入。
      expect(valid.sourceSpec).toBe('Readme.md')
    }
  })
})

/* ============================================================ *
 * createPlanDraft / renderPlanMarkdown
 * ============================================================ */

describe('createPlanDraft', () => {
  function baseInput(sourceSpec?: string): PlanDraftInput {
    return {
      title: '测试项目计划',
      sourceSpec,
      phases: [
        { name: '基础结构', description: '搭建项目骨架' },
        { name: '领域模型', description: '定义 Schema 与枚举' },
        { name: '数据层', description: '实现仓储适配' },
      ],
    }
  }

  it('分配 1-based order 并保留阶段顺序', () => {
    const draft = createPlanDraft(baseInput())
    expect(draft.phases.map((p) => p.order)).toEqual([1, 2, 3])
    expect(draft.phases.map((p) => p.name)).toEqual([
      '基础结构',
      '领域模型',
      '数据层',
    ])
  })

  it('标准模式 preface 声明 SPEC/ARCHITECTURE 已审查', () => {
    const draft = createPlanDraft(baseInput())
    expect(draft.sourceSpec).toBeUndefined()
    expect(draft.preface).toContain('已通过 Reviewer 独立审查')
  })

  it('自举模式 preface 含 source_spec 与人工确认声明', () => {
    const draft = createPlanDraft(baseInput('Readme.md'))
    expect(draft.sourceSpec).toBe('Readme.md')
    expect(draft.preface).toContain('`Readme.md`')
    expect(draft.preface).toContain('自举例外')
    expect(draft.preface).toContain('人工 / Reviewer 独立确认')
  })

  it('空 phases 抛错', () => {
    expect(() =>
      createPlanDraft({ title: '空计划', phases: [] }),
    ).toThrow(/至少需包含一个阶段/)
  })

  it('阶段名重复抛错', () => {
    expect(() =>
      createPlanDraft({
        title: '重复',
        phases: [
          { name: '同名', description: 'a' },
          { name: '同名', description: 'b' },
        ],
      }),
    ).toThrow(/阶段名重复：同名/)
  })

  it('阶段名为空抛错', () => {
    expect(() =>
      createPlanDraft({
        title: '空名',
        phases: [{ name: '   ', description: 'a' }],
      }),
    ).toThrow(/阶段名不能为空/)
  })
})

describe('renderPlanMarkdown', () => {
  it('渲染标题 + 前置说明 + 阶段列表', () => {
    const draft = createPlanDraft({
      title: '渲染测试',
      phases: [{ name: '阶段一', description: '做 A' }],
    })
    const md = renderPlanMarkdown(draft)
    expect(md).toContain('# 渲染测试')
    expect(md).toContain('## 阶段')
    expect(md).toContain('1. **阶段一**：做 A')
    expect(md.endsWith('\n')).toBe(true)
  })
})

/* ============================================================ *
 * createTaskDrafts
 * ============================================================ */

describe('createTaskDrafts', () => {
  it('生成的任务均为 draft 且通过 TaskFrontmatterSchema', () => {
    const { drafts } = createTaskDrafts({
      tasks: [
        makeSpec({ id: 'TASK-001' }),
        makeSpec({ id: 'TASK-002', depends_on: ['TASK-001'] }),
      ],
    })
    expect(drafts.map((d) => d.task.status)).toEqual(['draft', 'draft'])
    // id / title / layer 正确落位。
    expect(drafts[0]!.task.id).toBe('TASK-001')
    expect(drafts[1]!.task.depends_on).toEqual(['TASK-001'])
  })

  it('source_files 按依赖任务 allowed_paths 并集预填', () => {
    const { drafts } = createTaskDrafts({
      tasks: [
        makeSpec({
          id: 'TASK-001',
          allowed_paths: ['src/core/a.ts', 'src/core/b.ts'],
        }),
        makeSpec({
          id: 'TASK-002',
          allowed_paths: ['src/infra/c.ts'],
          depends_on: ['TASK-001'],
        }),
        makeSpec({
          id: 'TASK-003',
          depends_on: ['TASK-001', 'TASK-002'],
        }),
      ],
    })
    const t3 = drafts.find((d) => d.task.id === 'TASK-003')!
    // TASK-003 依赖 001 + 002 → source_files = 两者 allowed_paths 并集。
    expect(t3.task.context_pack.source_files).toEqual([
      'src/core/a.ts',
      'src/core/b.ts',
      'src/infra/c.ts',
    ])
  })

  it('spec 显式提供 source_files 时优先用之（不按依赖预填）', () => {
    const { drafts } = createTaskDrafts({
      tasks: [
        makeSpec({ id: 'TASK-001', allowed_paths: ['src/a.ts'] }),
        makeSpec({
          id: 'TASK-002',
          depends_on: ['TASK-001'],
          source_files: ['src/explicit.ts'],
        }),
      ],
    })
    const t2 = drafts.find((d) => d.task.id === 'TASK-002')!
    expect(t2.task.context_pack.source_files).toEqual(['src/explicit.ts'])
  })

  it('依赖指向集合外任务时，该依赖对 source_files 预填无贡献', () => {
    const { drafts } = createTaskDrafts({
      tasks: [
        // TASK-001 依赖集合外的 TASK-000（不存在于这批 drafts）→ source_files 为空。
        makeSpec({ id: 'TASK-001', depends_on: ['TASK-000'] }),
      ],
    })
    expect(drafts[0]!.task.context_pack.source_files).toEqual([])
  })

  it('computeContextPack 产出的 contextPack 含必读核心 + 当前任务文件', () => {
    const { drafts } = createTaskDrafts({
      tasks: [makeSpec({ id: 'TASK-001' })],
    })
    const pack = drafts[0]!.contextPack
    expect(pack.required_docs).toContain('AGENTS.md')
    expect(pack.required_docs).toContain('docs/ARCHITECTURE.md')
    expect(pack.required_docs).toContain('docs/PROGRESS.md')
    // 当前任务文件从 result_file 派生并入必读核心。
    expect(pack.required_docs).toContain('docs/tasks/TASK-001-x.md')
  })

  it('frontmatter.context_pack 存裁剪声明（不含任务文件 / 必读核心）', () => {
    const { drafts } = createTaskDrafts({
      tasks: [
        makeSpec({
          id: 'TASK-001',
          required_docs: ['docs/SPEC.md'],
          optional_doc_excerpts: ['Readme.md#1'],
        }),
      ],
    })
    const cp = drafts[0]!.task.context_pack
    expect(cp.required_docs).toEqual(['docs/SPEC.md'])
    expect(cp.optional_doc_excerpts).toEqual(['Readme.md#1'])
    // 任务文件不入 frontmatter.required_docs（§8：入口载体不计入数组）。
    expect(cp.required_docs).not.toContain('docs/tasks/TASK-001-x.md')
  })

  it('重复 id 抛错', () => {
    expect(() =>
      createTaskDrafts({
        tasks: [makeSpec({ id: 'TASK-001' }), makeSpec({ id: 'TASK-001' })],
      }),
    ).toThrow(/重复 id：TASK-001/)
  })

  it('非法 result_file（不以 .result.md 结尾）在 computeContextPack 阶段抛错', () => {
    expect(() =>
      createTaskDrafts({
        tasks: [makeSpec({ id: 'TASK-001', result_file: 'docs/tasks/bad.md' })],
      }),
    ).toThrow(/\.result\.md/)
  })
})

/* ============================================================ *
 * validateTaskGraph
 * ============================================================ */

describe('validateTaskGraph', () => {
  it('无环无冲突 → ok:true', () => {
    const result = validateTaskGraph([
      makeFrontmatter({ id: 'TASK-001' }),
      makeFrontmatter({ id: 'TASK-002', depends_on: ['TASK-001'] }),
    ])
    expect(result.ok).toBe(true)
    expect(result.hasCycle).toBe(false)
    expect(result.duplicateIds).toEqual([])
    expect(result.pathConflicts).toEqual([])
  })

  it('空任务集 → ok:true', () => {
    const result = validateTaskGraph([])
    expect(result.ok).toBe(true)
    expect(result.cyclePath).toBeNull()
  })

  it('两任务互依赖（2-环）→ hasCycle:true + cyclePath 非空 + ok:false', () => {
    const result = validateTaskGraph([
      makeFrontmatter({ id: 'TASK-001', depends_on: ['TASK-002'] }),
      makeFrontmatter({ id: 'TASK-002', depends_on: ['TASK-001'] }),
    ])
    expect(result.hasCycle).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.cyclePath).not.toBeNull()
    // 闭合环首尾相同。
    const path = result.cyclePath!
    expect(path[0]).toBe(path[path.length - 1])
  })

  it('三任务环 → hasCycle:true', () => {
    const result = validateTaskGraph([
      makeFrontmatter({ id: 'TASK-001', depends_on: ['TASK-003'] }),
      makeFrontmatter({ id: 'TASK-002', depends_on: ['TASK-001'] }),
      makeFrontmatter({ id: 'TASK-003', depends_on: ['TASK-002'] }),
    ])
    expect(result.hasCycle).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('重复 id → duplicateIds 非空 + ok:false', () => {
    const result = validateTaskGraph([
      makeFrontmatter({ id: 'TASK-001' }),
      makeFrontmatter({ id: 'TASK-001' }),
    ])
    expect(result.duplicateIds).toEqual(['TASK-001'])
    expect(result.ok).toBe(false)
    // 重复 id 时不误判为环。
    expect(result.hasCycle).toBe(false)
  })

  it('allowed_paths 重叠的两任务（无依赖）→ pathConflicts 非空，但 ok 仍 true', () => {
    const result = validateTaskGraph([
      makeFrontmatter({ id: 'TASK-001', allowed_paths: ['src/core/a.ts'] }),
      makeFrontmatter({ id: 'TASK-002', allowed_paths: ['src/core/a.ts'] }),
    ])
    expect(result.pathConflicts).toHaveLength(1)
    expect(result.pathConflicts[0]).toEqual({
      taskA: 'TASK-001',
      taskB: 'TASK-002',
    })
    // 路径冲突不阻断规划（§3.2 默认串行）。
    expect(result.ok).toBe(true)
  })

  it('allowed_paths 目录包含也判冲突', () => {
    const result = validateTaskGraph([
      makeFrontmatter({ id: 'TASK-001', allowed_paths: ['src/core'] }),
      makeFrontmatter({ id: 'TASK-002', allowed_paths: ['src/core/sub/x.ts'] }),
    ])
    expect(result.pathConflicts).toHaveLength(1)
  })

  it('allowed_paths 不相交 → 无冲突', () => {
    const result = validateTaskGraph([
      makeFrontmatter({ id: 'TASK-001', allowed_paths: ['src/core/a.ts'] }),
      makeFrontmatter({ id: 'TASK-002', allowed_paths: ['src/infra/b.ts'] }),
    ])
    expect(result.pathConflicts).toEqual([])
  })

  it('空 allowed_paths 任务不参与冲突', () => {
    const result = validateTaskGraph([
      makeFrontmatter({ id: 'TASK-001', allowed_paths: ['src/core/a.ts'] }),
      makeFrontmatter({ id: 'TASK-002', allowed_paths: [] }),
    ])
    expect(result.pathConflicts).toEqual([])
  })

  it('有依赖关系的任务对不计入路径冲突（即便路径重叠）', () => {
    const result = validateTaskGraph([
      makeFrontmatter({
        id: 'TASK-001',
        allowed_paths: ['src/core/a.ts'],
      }),
      makeFrontmatter({
        id: 'TASK-002',
        allowed_paths: ['src/core/a.ts'],
        depends_on: ['TASK-001'],
      }),
    ])
    // 有依赖本就串行，不计路径冲突。
    expect(result.pathConflicts).toEqual([])
    expect(result.ok).toBe(true)
  })
})
