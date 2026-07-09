import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildStartupPrompt,
  ClaudeSdkExecutor,
  DryRunLocalExecutor,
  ExecutorError,
  ExecutorNotConfiguredError,
  parseDocument,
  TaskDocRepository,
  type ClaudeSdkInvocation,
  type ExecuteInput,
  type SdkRunInput,
  type SdkRunReport,
} from '../../../src/infrastructure/index.js'
import { ResultFrontmatterSchema } from '../../../src/core/index.js'

/* ============================================================ *
 * 夹具：临时目录 + 合法 ExecuteInput 构造
 * ============================================================ */

let tmpRoot = ''
let tasksDir = ''
let worktreePath = ''

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sdk-exec-'))
  tasksDir = join(tmpRoot, 'docs', 'tasks')
  worktreePath = join(tmpRoot, 'worktree')
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

/** 构造合法 ExecuteInput（默认 TASK-022 + 两条验证命令）。 */
function makeInput(overrides?: Partial<ExecuteInput>): ExecuteInput {
  return {
    task_id: 'TASK-022',
    worktree_path: worktreePath,
    result_file: join(tasksDir, 'TASK-022-test.result.md'),
    context_pack: {
      required_docs: ['AGENTS.md', 'docs/ARCHITECTURE.md'],
      optional_doc_excerpts: ['Readme.md#16-权限模型'],
      source_files: ['src/core/rules/permission-rules.ts'],
    },
    permission_boundary: {
      allowed_paths: ['src/infrastructure/sdk/'],
      forbidden_paths: ['src/core/'],
      permissions: ['write_files'],
      verification_commands: [
        { command: 'npm run typecheck', source: 'project', requires_permissions: [] },
        { command: 'npm test -- infrastructure/sdk', source: 'task', requires_permissions: [] },
      ],
    },
    startup_prompt: buildStartupPrompt({
      taskId: 'TASK-022',
      taskFile: 'docs/tasks/TASK-022-infra-claude-sdk-adapter.md',
      resultFile: 'docs/tasks/TASK-022-infra-claude-sdk-adapter.result.md',
    }),
    ...overrides,
  }
}

/** 构造合法 SdkRunReport（默认 completed + 一条 passed 验证）。 */
function makeReport(overrides?: Partial<SdkRunReport>): SdkRunReport {
  return {
    executionStatus: 'completed',
    modifiedFiles: ['src/infrastructure/sdk/claude-sdk-adapter.ts'],
    createdFiles: ['src/infrastructure/sdk/executor-contract.ts'],
    deletedFiles: [],
    verification: [{ command: 'npm run typecheck', result: 'passed', notes: '' }],
    globalUpdateRequests: { progress: [], decisions: [], issues: [] },
    nextAction: 'review',
    summary: 'fake-sdk 执行摘要',
    ...overrides,
  }
}

/** 构造记录入参的 fake ClaudeSdkInvocation（不调用真实模型）。 */
function makeFakeInvocation(
  report: SdkRunReport,
  captured?: { input?: SdkRunInput },
): ClaudeSdkInvocation {
  return {
    name: 'fake-sdk',
    run: async (input) => {
      if (captured) captured.input = input
      return report
    },
  }
}

/** 读取 .result.md 并经 ResultFrontmatterSchema 校验返回 frontmatter（断言产物合法）。 */
function readResultFrontmatter(resultFile: string) {
  const raw = readFileSync(resultFile, 'utf8')
  const { frontmatter } = parseDocument(raw)
  return ResultFrontmatterSchema.parse(frontmatter)
}

/* ============================================================ *
 * buildStartupPrompt（§18 模板占位替换）
 * ============================================================ */

describe('buildStartupPrompt', () => {
  it('替换 §18 模板中的任务文件与结果文件占位', () => {
    const prompt = buildStartupPrompt({
      taskId: 'TASK-022',
      taskFile: 'docs/tasks/TASK-022-foo.md',
      resultFile: 'docs/tasks/TASK-022-foo.result.md',
    })

    // 不再残留占位符。
    expect(prompt).not.toContain('TASK-XXX-xxx')
    // 任务文件占位出现于「必读核心第 4 项」与「执行规则：本次上下文只执行」两处。
    expect(prompt).toContain('4. docs/tasks/TASK-022-foo.md')
    expect(prompt).toContain('本次上下文只执行 docs/tasks/TASK-022-foo.md')
    // 结果文件占位出现于「完成 / 阻塞 / 失败后必须生成」。
    expect(prompt).toContain('必须生成 docs/tasks/TASK-022-foo.result.md')
  })

  it('保留 §18 模板核心执行规则文本（AGENTS.md 为唯一权威）', () => {
    const prompt = buildStartupPrompt({
      taskId: 'TASK-001',
      taskFile: 'docs/tasks/TASK-001-bar.md',
      resultFile: 'docs/tasks/TASK-001-bar.result.md',
    })
    expect(prompt).toContain('不执行后续任务')
    expect(prompt).toContain('不依赖历史聊天记录')
    expect(prompt).toContain('AGENTS.md 是编码约束唯一权威')
  })
})

/* ============================================================ *
 * DryRunLocalExecutor（SDK 未就位兜底，不调用模型）
 * ============================================================ */

describe('DryRunLocalExecutor', () => {
  it('name 为 dry-run-local', () => {
    expect(new DryRunLocalExecutor().name).toBe('dry-run-local')
  })

  it('产出合法 .result.md（过 ResultFrontmatterSchema），outcome 与默认占位值一致', async () => {
    const executor = new DryRunLocalExecutor()
    const input = makeInput()
    const outcome = await executor.execute(input)

    expect(outcome.result_file).toBe(input.result_file)
    expect(outcome.execution_status).toBe('completed')

    const fm = readResultFrontmatter(input.result_file)
    expect(fm.task_id).toBe('TASK-022')
    expect(fm.execution_status).toBe('completed')
    // DryRun 不改动文件（除 .result.md 本身不计入）。
    expect(fm.modified_files).toEqual([])
    expect(fm.created_files).toEqual([])
    expect(fm.deleted_files).toEqual([])
    // execution_commits 由 Orchestrator 回填，Executor 留空。
    expect(fm.execution_commits).toEqual([])
    // global_update_requests 三项皆空。
    expect(fm.global_update_requests).toEqual({
      progress: [],
      decisions: [],
      issues: [],
    })
    expect(fm.next_action).toBe('review')
  })

  it('验证 allowlist 命令占位为 skipped 且保持输入顺序', async () => {
    const executor = new DryRunLocalExecutor()
    const input = makeInput()
    await executor.execute(input)

    const fm = readResultFrontmatter(input.result_file)
    expect(fm.verification).toHaveLength(2)
    expect(fm.verification[0]).toEqual({
      command: 'npm run typecheck',
      result: 'skipped',
      notes: 'dry-run 占位，未实际执行验证命令',
    })
    expect(fm.verification[1]?.command).toBe('npm test -- infrastructure/sdk')
    expect(fm.verification[1]?.result).toBe('skipped')
  })

  it('空验证 allowlist → verification 为空数组（仍过 Schema）', async () => {
    const executor = new DryRunLocalExecutor()
    const input = makeInput({
      permission_boundary: {
        allowed_paths: [],
        forbidden_paths: [],
        permissions: [],
        verification_commands: [],
      },
    })
    await executor.execute(input)
    expect(readResultFrontmatter(input.result_file).verification).toEqual([])
  })

  it('产出的 .result.md 可被 TaskDocRepository.readResult 读取（端到端链路）', async () => {
    const executor = new DryRunLocalExecutor()
    await executor.execute(makeInput())

    const repo = new TaskDocRepository(tasksDir)
    const fm = repo.readResult('TASK-022')
    expect(fm.task_id).toBe('TASK-022')
    expect(fm.execution_status).toBe('completed')
  })
})

/* ============================================================ *
 * ClaudeSdkExecutor（注入式 SDK 编排骨架）
 * ============================================================ */

describe('ClaudeSdkExecutor', () => {
  it('name 为 claude-sdk', () => {
    expect(new ClaudeSdkExecutor(null).name).toBe('claude-sdk')
  })

  it('未注入 invocation 时 execute 抛 ExecutorNotConfiguredError（不伪造调用）', async () => {
    const executor = new ClaudeSdkExecutor(null)
    await expect(executor.execute(makeInput())).rejects.toBeInstanceOf(
      ExecutorNotConfiguredError,
    )
  })

  it('ExecutorNotConfiguredError 是 ExecutorError 子类', () => {
    const err = new ExecutorNotConfiguredError('claude-sdk')
    expect(err).toBeInstanceOf(ExecutorError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ExecutorNotConfiguredError')
  })

  it('注入 fake invocation → 调用 run 并把入参投影为 SdkRunInput', async () => {
    const captured: { input?: SdkRunInput } = {}
    const executor = new ClaudeSdkExecutor(
      makeFakeInvocation(makeReport(), captured),
    )
    const input = makeInput()
    await executor.execute(input)

    expect(captured.input).toBeDefined()
    expect(captured.input?.worktreePath).toBe(input.worktree_path)
    expect(captured.input?.startupPrompt).toBe(input.startup_prompt)
    expect(captured.input?.contextPack).toEqual(input.context_pack)
    expect(captured.input?.permissionBoundary).toEqual(input.permission_boundary)
  })

  it('report 落盘为合法 .result.md，frontmatter 字段来自 report', async () => {
    const report = makeReport()
    const executor = new ClaudeSdkExecutor(makeFakeInvocation(report))
    const input = makeInput()
    const outcome = await executor.execute(input)

    expect(outcome.execution_status).toBe('completed')

    const fm = readResultFrontmatter(input.result_file)
    expect(fm.task_id).toBe('TASK-022')
    expect(fm.execution_status).toBe('completed')
    expect(fm.modified_files).toEqual(report.modifiedFiles)
    expect(fm.created_files).toEqual(report.createdFiles)
    expect(fm.deleted_files).toEqual(report.deletedFiles)
    expect(fm.verification).toEqual(report.verification)
    expect(fm.global_update_requests).toEqual(report.globalUpdateRequests)
    expect(fm.next_action).toBe('review')
    // execution_commits 始终留空（Orchestrator 回填）。
    expect(fm.execution_commits).toEqual([])
  })

  it('report 为 blocked + needs-human 时 outcome 与 frontmatter 一致（合法组合）', async () => {
    const report = makeReport({
      executionStatus: 'blocked',
      nextAction: 'needs-human',
      verification: [{ command: 'npm run typecheck', result: 'failed', notes: '类型错误' }],
    })
    const executor = new ClaudeSdkExecutor(makeFakeInvocation(report))
    const outcome = await executor.execute(makeInput())

    expect(outcome.execution_status).toBe('blocked')
    const fm = readResultFrontmatter(makeInput().result_file)
    expect(fm.execution_status).toBe('blocked')
    expect(fm.next_action).toBe('needs-human')
    expect(fm.verification[0]?.result).toBe('failed')
  })

  it('产出的 .result.md 可被 TaskDocRepository.readResult 读取（端到端链路）', async () => {
    const executor = new ClaudeSdkExecutor(makeFakeInvocation(makeReport()))
    await executor.execute(makeInput())

    const repo = new TaskDocRepository(tasksDir)
    const fm = repo.readResult('TASK-022')
    expect(fm.execution_status).toBe('completed')
    expect(fm.modified_files).toEqual(['src/infrastructure/sdk/claude-sdk-adapter.ts'])
  })
})
