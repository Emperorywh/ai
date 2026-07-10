import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskDocRepository } from '../../src/infrastructure/index.js'
import type { TaskFrontmatter } from '../../src/core/index.js'
import {
  buildTaskBody,
  createSingleTask,
  slugify,
} from '../../src/cli/commands/task-create.js'
import {
  parsePlanDefinition,
  planProject,
  PlanDefinitionSchema,
} from '../../src/cli/commands/plan.js'
import { CliExitCode, createProgram, runCli } from '../../src/cli/framework.js'

/* ============================================================ *
 * 夹具：临时项目根
 * ============================================================ */

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'caw-plan-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

/** 在项目根写入 docs/SPEC.md + docs/ARCHITECTURE.md（standard 模式前置）。 */
function writeSpecAndArch(): void {
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'docs', 'SPEC.md'), '# SPEC\n', 'utf8')
  writeFileSync(join(root, 'docs', 'ARCHITECTURE.md'), '# ARCHITECTURE\n', 'utf8')
}

/** 一份合法的计划定义 YAML（含两任务 + 依赖，用于 source_files 预填断言）。 */
function twoTaskYaml(): string {
  return [
    'title: 测试项目计划',
    'phases:',
    '  - name: 基础结构',
    '    description: 搭建项目骨架',
    '  - name: 领域模型',
    '    description: 定义 Schema',
    'tasks:',
    '  - id: TASK-001',
    '    title: 枚举与原语',
    '    layer: type',
    '    allowed_paths:',
    '      - src/core/enums.ts',
    '    verification:',
    '      - npm run typecheck',
    '    result_file: docs/tasks/TASK-001-enums.result.md',
    '  - id: TASK-002',
    '    title: 状态机',
    '    layer: domain',
    '    depends_on:',
    '      - TASK-001',
    '    allowed_paths:',
    '      - src/core/state-machine.ts',
    '    verification:',
    '      - npm run typecheck',
    '    result_file: docs/tasks/TASK-002-state-machine.result.md',
    '',
  ].join('\n')
}

/* ============================================================ *
 * slugify
 * ============================================================ */

describe('slugify', () => {
  it('英文标题派生 kebab-case slug', () => {
    expect(slugify('Core Enums')).toBe('core-enums')
    expect(slugify('CLI plan 与 task:create')).toBe('cli-plan-task-create')
    expect(slugify('  Trim  Me  ')).toBe('trim-me')
  })

  it('纯中文 / 非 ascii 标题派生为空', () => {
    expect(slugify('枚举与原语')).toBe('')
    expect(slugify('数据层')).toBe('')
  })
})

/* ============================================================ *
 * buildTaskBody（§9 十三节正文模板）
 * ============================================================ */

describe('buildTaskBody', () => {
  function mkTask(overrides: Partial<TaskFrontmatter> = {}): TaskFrontmatter {
    return {
      id: 'TASK-001',
      title: '测试任务',
      status: 'draft',
      layer: 'type',
      depends_on: [],
      allowed_paths: ['src/core/a.ts'],
      forbidden_paths: ['src/infra/b.ts'],
      permissions: [],
      no_review: false,
      restart_on_retry: false,
      verification: ['npm run typecheck'],
      context_pack: { required_docs: [], optional_doc_excerpts: [], source_files: [] },
      workflow_outputs: { result_file: 'docs/tasks/TASK-001-a.result.md' },
      ...overrides,
    }
  }

  it('含 §9 全部十三节标题', () => {
    const body = buildTaskBody(mkTask())
    for (let i = 1; i <= 13; i++) {
      expect(body).toContain(`## ${i}.`)
    }
    expect(body).toContain('# TASK-001 测试任务')
  })

  it('预填 layer / 必读文件 / 修改范围 / 禁止范围 / result_file', () => {
    const body = buildTaskBody(mkTask())
    expect(body).toContain('`type`')
    expect(body).toContain('docs/tasks/TASK-001-a.md')
    expect(body).toContain('- src/core/a.ts')
    expect(body).toContain('- src/infra/b.ts')
    expect(body).toContain('docs/tasks/TASK-001-a.result.md')
  })
})

/* ============================================================ *
 * createSingleTask
 * ============================================================ */

describe('createSingleTask', () => {
  it('生成合法任务文件：status=draft + 预填 context_pack，过 TaskFrontmatterSchema', () => {
    const outcome = createSingleTask({
      projectRoot: root,
      id: 'TASK-001',
      title: 'Core Enums',
      layer: 'type',
      allowed_paths: ['src/core/enums.ts'],
      verification: ['npm run typecheck'],
    })

    expect(outcome.resultFile).toBe('docs/tasks/TASK-001-core-enums.result.md')
    expect(existsSync(outcome.taskFile)).toBe(true)
    // 经 TaskDocRepository.readTask 做 Zod 校验（读取即校验，DEC-008）。
    const repo = new TaskDocRepository(join(root, 'docs', 'tasks'))
    const task = repo.readTask('TASK-001')
    expect(task.status).toBe('draft')
    expect(task.layer).toBe('type')
    expect(task.workflow_outputs.result_file).toBe(outcome.resultFile)
    // context_pack 含预填声明（computeContextPack 完整清单含必读核心，frontmatter 存裁剪声明）。
    expect(task.context_pack.required_docs).toEqual([])
    expect(task.context_pack.source_files).toEqual([])
  })

  it('显式 source_files 预填写入 frontmatter', () => {
    const outcome = createSingleTask({
      projectRoot: root,
      id: 'TASK-002',
      title: 'State Machine',
      slug: 'state-machine',
      layer: 'domain',
      allowed_paths: ['src/core/state-machine.ts'],
      verification: ['npm run typecheck'],
      source_files: ['src/core/enums.ts'],
      required_docs: ['docs/SPEC.md'],
    })
    expect(outcome.taskFile).toContain('state-machine.md')
    const repo = new TaskDocRepository(join(root, 'docs', 'tasks'))
    const task = repo.readTask('TASK-002')
    expect(task.context_pack.source_files).toEqual(['src/core/enums.ts'])
    expect(task.context_pack.required_docs).toEqual(['docs/SPEC.md'])
  })

  it('非法 id 抛错', () => {
    expect(() =>
      createSingleTask({
        projectRoot: root,
        id: 'TASK-ABC',
        title: 'Bad',
        layer: 'type',
        allowed_paths: [],
        verification: ['npm run typecheck'],
      }),
    ).toThrow(/任务 id 非法/)
  })

  it('非法 layer 抛错', () => {
    expect(() =>
      createSingleTask({
        projectRoot: root,
        id: 'TASK-003',
        title: 'Bad',
        layer: 'unknown' as never,
        allowed_paths: [],
        verification: ['npm run typecheck'],
      }),
    ).toThrow(/layer 非法/)
  })

  it('纯中文标题无 --slug → 派生空 slug 抛错', () => {
    expect(() =>
      createSingleTask({
        projectRoot: root,
        id: 'TASK-004',
        title: '枚举与原语',
        layer: 'type',
        allowed_paths: [],
        verification: ['npm run typecheck'],
      }),
    ).toThrow(/slug 非法或为空/)
  })

  it('任务文件已存在 → 拒绝覆盖', () => {
    createSingleTask({
      projectRoot: root,
      id: 'TASK-005',
      title: 'First',
      layer: 'type',
      allowed_paths: [],
      verification: ['npm run typecheck'],
    })
    expect(() =>
      createSingleTask({
        projectRoot: root,
        id: 'TASK-005',
        title: 'First',
        layer: 'type',
        allowed_paths: [],
        verification: ['npm run typecheck'],
      }),
    ).toThrow(/任务文件已存在/)
  })

  it('写入的文件含十三节正文模板', () => {
    const outcome = createSingleTask({
      projectRoot: root,
      id: 'TASK-006',
      title: 'With Body',
      layer: 'page',
      allowed_paths: ['src/cli/x.ts'],
      verification: ['npm run typecheck'],
    })
    const raw = readFileSync(outcome.taskFile, 'utf8')
    for (let i = 1; i <= 13; i++) {
      expect(raw).toContain(`## ${i}.`)
    }
  })
})

/* ============================================================ *
 * parsePlanDefinition
 * ============================================================ */

describe('parsePlanDefinition', () => {
  it('解析合法 YAML 计划定义', () => {
    const def = parsePlanDefinition(twoTaskYaml())
    expect(def.title).toBe('测试项目计划')
    expect(def.phases).toHaveLength(2)
    expect(def.phases[0]!.name).toBe('基础结构')
    expect(def.tasks).toHaveLength(2)
    expect(def.tasks[1]!.depends_on).toEqual(['TASK-001'])
  })

  it('JSON 也是合法输入（YAML 超集）', () => {
    const json = JSON.stringify({
      title: 'JSON 计划',
      phases: [{ name: 'P1', description: 'd' }],
      tasks: [
        {
          id: 'TASK-001',
          title: 'T',
          layer: 'type',
          allowed_paths: [],
          verification: [],
          result_file: 'docs/tasks/TASK-001-t.result.md',
        },
      ],
    })
    const def = parsePlanDefinition(json)
    expect(def.title).toBe('JSON 计划')
  })

  it('缺必填字段（title）→ 抛错', () => {
    expect(() =>
      parsePlanDefinition(
        'phases:\n  - name: P1\n    description: d\ntasks: []\n',
      ),
    ).toThrow(/计划定义校验失败/)
  })

  it('空 phases → 抛错', () => {
    expect(() =>
      parsePlanDefinition(
        'title: x\nphases: []\ntasks:\n  - id: TASK-001\n    title: t\n    layer: type\n    allowed_paths: []\n    verification: []\n    result_file: docs/tasks/TASK-001-t.result.md\n',
      ),
    ).toThrow(/至少需要一个阶段/)
  })

  it('非法 YAML 语法 → 抛错', () => {
    expect(() => parsePlanDefinition('title: [unclosed')).toThrow(/解析失败/)
  })
})

/* ============================================================ *
 * planProject
 * ============================================================ */

describe('planProject — standard 模式', () => {
  it('SPEC+ARCH 存在 + reviewed → 生成 PLAN.md + 任务文件（draft + 预填 context_pack）', () => {
    writeSpecAndArch()
    const def = parsePlanDefinition(twoTaskYaml())

    const outcome = planProject({ projectRoot: root, reviewed: true, definition: def })

    expect(outcome.mode).toBe('standard')
    expect(existsSync(outcome.planFile)).toBe(true)
    expect(outcome.taskFiles).toHaveLength(2)
    for (const f of outcome.taskFiles) expect(existsSync(f)).toBe(true)

    // PLAN.md 含标题与阶段。
    const plan = readFileSync(outcome.planFile, 'utf8')
    expect(plan).toContain('# 测试项目计划')
    expect(plan).toContain('基础结构')
    expect(plan).toContain('审查')

    // 任务文件 status=draft + TASK-002 source_files 按依赖 allowed_paths 预填（§8）。
    const repo = new TaskDocRepository(join(root, 'docs', 'tasks'))
    const t1 = repo.readTask('TASK-001')
    const t2 = repo.readTask('TASK-002')
    expect(t1.status).toBe('draft')
    expect(t2.status).toBe('draft')
    expect(t2.context_pack.source_files).toEqual(['src/core/enums.ts'])
    expect(t2.depends_on).toEqual(['TASK-001'])
  })

  it('SPEC+ARCH 存在但未 --reviewed 且无 sourceSpec → 拒绝生成', () => {
    writeSpecAndArch()
    const def = parsePlanDefinition(twoTaskYaml())
    expect(() =>
      planProject({ projectRoot: root, reviewed: false, definition: def }),
    ).toThrow(/规划前置不满足/)
    // 拒绝时不落盘任何文件。
    expect(existsSync(join(root, 'docs', 'PLAN.md'))).toBe(false)
    expect(existsSync(join(root, 'docs', 'tasks'))).toBe(false)
  })
})

describe('planProject — bootstrap 模式', () => {
  it('声明 sourceSpec + 无 SPEC/ARCH → bootstrap，PLAN preface 含自举声明', () => {
    const yaml = [
      'title: 自举计划',
      'sourceSpec: Readme.md',
      'phases:',
      '  - name: P1',
      '    description: d',
      'tasks:',
      '  - id: TASK-001',
      '    title: T',
      '    layer: type',
      '    allowed_paths: []',
      '    verification: []',
      '    result_file: docs/tasks/TASK-001-t.result.md',
      '',
    ].join('\n')
    const def = parsePlanDefinition(yaml)

    const outcome = planProject({ projectRoot: root, reviewed: false, definition: def })

    expect(outcome.mode).toBe('bootstrap')
    const plan = readFileSync(outcome.planFile, 'utf8')
    expect(plan).toContain('`Readme.md`')
    expect(plan).toContain('自举例外')
  })
})

describe('planProject — 任务图校验', () => {
  it('依赖环 → 抛错且不落盘任务文件', () => {
    writeSpecAndArch()
    const yaml = [
      'title: 环计划',
      'phases:',
      '  - name: P1',
      '    description: d',
      'tasks:',
      '  - id: TASK-001',
      '    title: A',
      '    layer: type',
      '    depends_on: [TASK-002]',
      '    allowed_paths: []',
      '    verification: []',
      '    result_file: docs/tasks/TASK-001-a.result.md',
      '  - id: TASK-002',
      '    title: B',
      '    layer: type',
      '    depends_on: [TASK-001]',
      '    allowed_paths: []',
      '    verification: []',
      '    result_file: docs/tasks/TASK-002-b.result.md',
      '',
    ].join('\n')
    const def = parsePlanDefinition(yaml)

    expect(() =>
      planProject({ projectRoot: root, reviewed: true, definition: def }),
    ).toThrow(/依赖环/)
    // 先校验后写盘：环检测在落盘前，不产生任务文件。
    expect(existsSync(join(root, 'docs', 'tasks'))).toBe(false)
  })

  it('allowed_paths 重叠的两无依赖任务 → pathConflicts 非空但正常生成', () => {
    writeSpecAndArch()
    const yaml = [
      'title: 冲突计划',
      'phases:',
      '  - name: P1',
      '    description: d',
      'tasks:',
      '  - id: TASK-001',
      '    title: A',
      '    layer: type',
      '    allowed_paths: [src/shared.ts]',
      '    verification: []',
      '    result_file: docs/tasks/TASK-001-a.result.md',
      '  - id: TASK-002',
      '    title: B',
      '    layer: type',
      '    allowed_paths: [src/shared.ts]',
      '    verification: []',
      '    result_file: docs/tasks/TASK-002-b.result.md',
      '',
    ].join('\n')
    const def = parsePlanDefinition(yaml)

    const outcome = planProject({ projectRoot: root, reviewed: true, definition: def })

    expect(outcome.pathConflicts).toHaveLength(1)
    expect(outcome.taskFiles).toHaveLength(2)
  })
})

/* ============================================================ *
 * runCli（退出码 + 输出）
 * ============================================================ */

describe('runCli — plan / task:create 退出码', () => {
  it('task:create 经 runCli 生成任务文件并返回成功退出码', async () => {
    const exit = await runCli([
      'task:create',
      '--id', 'TASK-401',
      '--title', 'Run Cli Task',
      '--layer', 'page',
      '--allowed-paths', 'src/cli/x.ts',
      '--project-root', root,
    ])
    expect(exit).toBe(CliExitCode.Success)
    expect(existsSync(join(root, 'docs', 'tasks', 'TASK-401-run-cli-task.md'))).toBe(true)
  })

  it('task:create 非法 layer 返回非零退出码', async () => {
    const exit = await runCli([
      'task:create',
      '--id', 'TASK-402',
      '--title', 'Bad',
      '--layer', 'nope',
      '--project-root', root,
    ])
    expect(exit).not.toBe(CliExitCode.Success)
  })

  it('plan 经 runCli 生成 PLAN + 任务文件并返回成功退出码', async () => {
    writeSpecAndArch()
    const configPath = join(root, 'plan.yaml')
    writeFileSync(configPath, twoTaskYaml(), 'utf8')
    const logs = spyOnConsole('log')

    const exit = await runCli([
      'plan',
      '--from', configPath,
      '--reviewed',
      '--project-root', root,
    ])

    expect(exit).toBe(CliExitCode.Success)
    expect(existsSync(join(root, 'docs', 'PLAN.md'))).toBe(true)
    expect(logs.join('\n')).toContain('standard')
  })

  it('plan 前置不满足（未 --reviewed 且无 sourceSpec）返回非零退出码', async () => {
    writeSpecAndArch()
    const configPath = join(root, 'plan.yaml')
    writeFileSync(configPath, twoTaskYaml(), 'utf8')

    const exit = await runCli(['plan', '--from', configPath, '--project-root', root])
    expect(exit).not.toBe(CliExitCode.Success)
  })

  it('plan 配置文件不存在返回非零退出码', async () => {
    const exit = await runCli([
      'plan',
      '--from', join(root, 'missing.yaml'),
      '--project-root', root,
    ])
    expect(exit).not.toBe(CliExitCode.Success)
  })

  it('plan 与 task:create 已注册到 createProgram', () => {
    const names = createProgram().commands.map((c) => c.name())
    expect(names).toContain('plan')
    expect(names).toContain('task:create')
  })

  it('--help 返回成功退出码', async () => {
    const exit = await runCli(['--help'])
    expect(exit).toBe(CliExitCode.Success)
  })
})

/* ============================================================ *
 * 辅助
 * ============================================================ */

/** PlanDefinitionSchema 导出可用（配置 schema 单一来源）。 */
describe('PlanDefinitionSchema', () => {
  it('safeParse 合法定义通过', () => {
    const parsed = PlanDefinitionSchema.safeParse(parsePlanDefinition(twoTaskYaml()))
    expect(parsed.success).toBe(true)
  })
})

/** 捕获 console.log 全部调用参数，返回累加数组。 */
function spyOnConsole(method: 'log' | 'warn'): string[] {
  const buffer: string[] = []
  vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
    buffer.push(args.map((a) => String(a)).join(' '))
  })
  return buffer
}
