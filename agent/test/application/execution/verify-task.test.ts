/**
 * VerifyTaskUseCase 单测（TASK-039 / SPEC FR-011 / FR-012）。
 *
 * 用 fake VerificationRunnerPort 覆盖 §11 全部验收：
 *   - fake Runner 覆盖 passed / failed / skipped / 退出码 / 超时。
 *   - requires_permissions 缺失时 Runner 不被调用。
 *   - 验证严格串行且顺序确定（runner 调用顺序 = allowlist 顺序）。
 *   - 同名系统记录覆盖模型自报，未执行命令不能伪装 passed。
 *   - no_review 接受规则不再把任意 skipped 当作通过（门禁只认系统记录 result === 'passed'）。
 */
import { describe, expect, it } from 'vitest'
import { VerifyTaskUseCase } from '../../../src/application/execution/verify-task.js'
import type { VerifyTaskPorts } from '../../../src/application/execution/verify-task.js'
import type {
  VerificationRunnerInput,
  VerificationRunnerPort,
  VerificationRunnerResult,
} from '../../../src/application/execution/ports.js'
import type {
  Layer,
  Permission,
  ResultVerification,
  TestingCommand,
} from '../../../src/core/index.js'

/* ============================================================ *
 * 内存 fake：VerificationRunnerPort
 * ============================================================ */

/**
 * 内存 fake Runner：按命令脚本化返回值，记录调用顺序（断言串行 + Runner 调用次数）。
 *
 * 未脚本化的命令 run 时抛错（不静默、不伪造），确保测试显式覆盖每条 allowlist 命令。
 */
class FakeRunner implements VerificationRunnerPort {
  readonly name = 'fake-runner'
  readonly runCalls: Array<{ command: string; worktreePath: string }> = []
  private readonly results = new Map<string, VerificationRunnerResult>()

  /** 按命令脚本化返回值。 */
  script(command: string, result: VerificationRunnerResult): void {
    this.results.set(command, result)
  }

  async run(input: VerificationRunnerInput): Promise<VerificationRunnerResult> {
    this.runCalls.push({ command: input.command, worktreePath: input.worktreePath })
    const r = this.results.get(input.command)
    if (r === undefined) {
      throw new Error(`fake runner 未脚本化命令：${input.command}`)
    }
    return r
  }
}

/* ============================================================ *
 * 夹具
 * ============================================================ */

/** 项目级验证命令声明（domain layer 命中 typecheck / test / lint，镜像 docs/TESTING.md）。 */
const DOMAIN_TESTING_COMMANDS: readonly TestingCommand[] = [
  { command: 'npm run typecheck', layers: ['type', 'domain', 'data', 'page'] },
  { command: 'npm test', layers: ['type', 'domain', 'data', 'page'] },
  { command: 'npm run lint', layers: ['type', 'domain', 'data', 'page'] },
]

/** 构造模型自报记录（source='model'）。 */
function modelRec(
  command: string,
  result: 'passed' | 'failed' | 'skipped',
): ResultVerification {
  return {
    command,
    result,
    notes: '模型自报',
    source: 'model',
    exit_code: null,
    duration_ms: 0,
    output_summary: '',
  }
}

/** 构造 VerifyTaskUseCase 调用参数。 */
function makeInput(opts: {
  worktreePath?: string
  taskLayer?: Layer
  taskPermissions?: readonly Permission[]
  taskVerification?: readonly string[]
  testingCommands?: readonly TestingCommand[]
  modelVerification?: readonly ResultVerification[]
}): {
  taskId: string
  worktreePath: string
  taskLayer: Layer
  taskPermissions: readonly Permission[]
  taskVerification: readonly string[]
  testingCommands: readonly TestingCommand[]
  modelVerification: readonly ResultVerification[]
} {
  return {
    taskId: 'TASK-039',
    worktreePath: opts.worktreePath ?? '/fake/worktrees/TASK-039',
    taskLayer: opts.taskLayer ?? 'domain',
    taskPermissions: opts.taskPermissions ?? [],
    taskVerification: opts.taskVerification ?? [],
    testingCommands: opts.testingCommands ?? DOMAIN_TESTING_COMMANDS,
    modelVerification: opts.modelVerification ?? [],
  }
}

/** 装配用例 + fake runner。 */
function setup(): { useCase: VerifyTaskUseCase; runner: FakeRunner } {
  const runner = new FakeRunner()
  const ports: VerifyTaskPorts = { runner }
  return { useCase: new VerifyTaskUseCase(ports), runner }
}

/** 脚造 fake runner passed 结果。 */
function passed(command: string, durationMs = 100): VerificationRunnerResult {
  return { command, result: 'passed', exitCode: 0, durationMs, outputSummary: `${command} 通过` }
}

/** 脚造 fake runner failed 结果。 */
function failed(command: string, exitCode = 1): VerificationRunnerResult {
  return { command, result: 'failed', exitCode, durationMs: 200, outputSummary: `${command} 失败摘要` }
}

/** 脚造 fake runner skipped 结果。 */
function skipped(command: string): VerificationRunnerResult {
  return { command, result: 'skipped', exitCode: null, durationMs: 0, outputSummary: `${command} 跳适用` }
}

/** 脚造 fake runner 超时结果（exitCode=null，outputSummary 注明超时）。 */
function timedOut(command: string): VerificationRunnerResult {
  return { command, result: 'failed', exitCode: null, durationMs: 30000, outputSummary: '执行超时' }
}

/* ============================================================ *
 * passed 路径（门禁通过）
 * ============================================================ */

describe('VerifyTaskUseCase：passed 路径', () => {
  it('allowlist 全 passed → status=passed, nextAction=review', async () => {
    const { useCase, runner } = setup()
    runner.script('npm run typecheck', passed('npm run typecheck'))
    runner.script('npm test', passed('npm test'))
    runner.script('npm run lint', passed('npm run lint'))

    const outcome = await useCase.verify(makeInput({}))

    expect(outcome.status).toBe('passed')
    expect(outcome.nextAction).toBe('review')
    expect(outcome.deniedCommands).toEqual([])
    expect(outcome.proposedIssues).toEqual([])
    expect(outcome.failureReason).toBeUndefined()
  })

  it('系统记录写全四元组（source=system + exit_code/duration_ms/output_summary）', async () => {
    const { useCase, runner } = setup()
    runner.script('npm run typecheck', passed('npm run typecheck', 320))

    const outcome = await useCase.verify(
      makeInput({
        testingCommands: [{ command: 'npm run typecheck', layers: ['domain'] }],
        taskVerification: [],
      }),
    )

    const rec = outcome.verification.find((v) => v.command === 'npm run typecheck')
    expect(rec).toBeDefined()
    if (rec) {
      expect(rec.source).toBe('system')
      expect(rec.exit_code).toBe(0)
      expect(rec.duration_ms).toBe(320)
      expect(rec.output_summary).toBe('npm run typecheck 通过')
    }
  })

  it('空 allowlist → passed（无命令需验证）', async () => {
    const { useCase } = setup()
    // test layer 不在 DOMAIN_TESTING_COMMANDS 任一 layers → allowlist 空。
    const outcome = await useCase.verify(makeInput({ taskLayer: 'test' }))
    expect(outcome.status).toBe('passed')
  })
})

/* ============================================================ *
 * 门禁不通过：failed / skipped / 未执行
 * ============================================================ */

describe('VerifyTaskUseCase：门禁不通过（blocked）', () => {
  it('某命令 failed → blocked + needs-human + 验证失败 issue', async () => {
    const { useCase, runner } = setup()
    runner.script('npm run typecheck', passed('npm run typecheck'))
    runner.script('npm test', failed('npm test'))
    runner.script('npm run lint', passed('npm run lint'))

    const outcome = await useCase.verify(makeInput({}))

    expect(outcome.status).toBe('blocked')
    expect(outcome.nextAction).toBe('needs-human')
    expect(outcome.proposedIssues).toHaveLength(1)
    expect(outcome.proposedIssues[0]?.title).toContain('系统验证未通过')
    expect(outcome.proposedIssues[0]?.severity).toBe('high')
    expect(outcome.proposedIssues[0]?.created_from_task).toBe('TASK-039')
    expect(outcome.proposedIssues[0]?.id).toBe('')
    expect(outcome.failureReason).toContain('npm test=failed')
  })

  it('某命令 skipped → blocked（不再把任意 skipped 当作通过）', async () => {
    const { useCase, runner } = setup()
    runner.script('npm run typecheck', passed('npm run typecheck'))
    runner.script('npm test', skipped('npm test'))
    runner.script('npm run lint', passed('npm run lint'))

    const outcome = await useCase.verify(makeInput({}))

    expect(outcome.status).toBe('blocked')
    expect(outcome.nextAction).toBe('needs-human')
    expect(outcome.failureReason).toContain('skipped')
  })

  it('超时映射为 failed → blocked', async () => {
    const { useCase, runner } = setup()
    runner.script('npm run typecheck', passed('npm run typecheck'))
    runner.script('npm test', timedOut('npm test'))
    runner.script('npm run lint', passed('npm run lint'))

    const outcome = await useCase.verify(makeInput({}))

    expect(outcome.status).toBe('blocked')
    // 超时的系统记录：result=failed + exitCode=null + outputSummary 注明超时
    const rec = outcome.verification.find((v) => v.command === 'npm test')
    expect(rec).toBeDefined()
    if (rec) {
      expect(rec.result).toBe('failed')
      expect(rec.exit_code).toBeNull()
      expect(rec.output_summary).toBe('执行超时')
    }
  })
})

/* ============================================================ *
 * 权限缺失：Runner 不被调用（§11 验收）
 * ============================================================ */

describe('VerifyTaskUseCase：requires_permissions 缺失', () => {
  it('权限缺失 → blocked + needs-human + Runner 未被调用 + 权限不足 issue', async () => {
    const { useCase, runner } = setup()
    // install 命令声明 install_dependencies，任务未声明该能力。
    const testingCommands: readonly TestingCommand[] = [
      { command: 'npm test', layers: ['domain'] },
      {
        command: 'npm install',
        layers: ['domain'],
        requires_permissions: ['install_dependencies'],
      },
    ]

    const outcome = await useCase.verify(
      makeInput({ testingCommands, taskPermissions: [] }),
    )

    expect(outcome.status).toBe('blocked')
    expect(outcome.nextAction).toBe('needs-human')
    expect(runner.runCalls).toHaveLength(0) // Runner 不被调用
    expect(outcome.deniedCommands).toEqual([
      { command: 'npm install', missing: ['install_dependencies'] },
    ])
    expect(outcome.proposedIssues).toHaveLength(1)
    expect(outcome.proposedIssues[0]?.title).toContain('权限不足')
    // allowlist 命令标 skipped（权限不足未执行）
    const installRec = outcome.verification.find((v) => v.command === 'npm install')
    expect(installRec).toBeDefined()
    if (installRec) {
      expect(installRec.result).toBe('skipped')
      expect(installRec.source).toBe('system')
    }
  })

  it('权限覆盖时 Runner 正常调用', async () => {
    const { useCase, runner } = setup()
    runner.script('npm install', passed('npm install'))
    const outcome = await useCase.verify(
      makeInput({
        testingCommands: [
          {
            command: 'npm install',
            layers: ['domain'],
            requires_permissions: ['install_dependencies'],
          },
        ],
        taskPermissions: ['install_dependencies'],
      }),
    )
    expect(outcome.status).toBe('passed')
    expect(runner.runCalls).toHaveLength(1)
  })
})

/* ============================================================ *
 * 串行 + 顺序确定（§11 验收）
 * ============================================================ */

describe('VerifyTaskUseCase：严格串行且顺序确定', () => {
  it('runner 按 allowlist 顺序串行调用', async () => {
    const { useCase, runner } = setup()
    runner.script('npm run typecheck', passed('npm run typecheck'))
    runner.script('npm test', passed('npm test'))
    runner.script('npm run lint', passed('npm run lint'))

    await useCase.verify(makeInput({}))

    // allowlist 顺序 = TESTING.md 声明顺序：typecheck → test → lint。
    expect(runner.runCalls.map((c) => c.command)).toEqual([
      'npm run typecheck',
      'npm test',
      'npm run lint',
    ])
  })

  it('runner 工作目录 = worktreePath', async () => {
    const { useCase, runner } = setup()
    runner.script('npm run typecheck', passed('npm run typecheck'))
    await useCase.verify(
      makeInput({
        worktreePath: '/wt/X',
        testingCommands: [{ command: 'npm run typecheck', layers: ['domain'] }],
      }),
    )
    expect(runner.runCalls[0]?.worktreePath).toBe('/wt/X')
  })
})

/* ============================================================ *
 * 系统覆盖模型自报 + 模型独有命令保留（§11 验收）
 * ============================================================ */

describe('VerifyTaskUseCase：系统记录覆盖模型自报', () => {
  it('模型自报 passed 被系统 failed 覆盖（未执行命令不能伪装 passed）', async () => {
    const { useCase, runner } = setup()
    // 模型自报 npm test = passed，但系统执行 failed。
    runner.script('npm run typecheck', passed('npm run typecheck'))
    runner.script('npm test', failed('npm test'))
    runner.script('npm run lint', passed('npm run lint'))

    const outcome = await useCase.verify(
      makeInput({
        modelVerification: [modelRec('npm test', 'passed')],
      }),
    )

    // 门禁以系统记录为准 → blocked（模型 passed 被覆盖）。
    expect(outcome.status).toBe('blocked')
    const rec = outcome.verification.find((v) => v.command === 'npm test')
    expect(rec).toBeDefined()
    if (rec) {
      expect(rec.result).toBe('failed')
      expect(rec.source).toBe('system') // 系统记录覆盖模型自报
    }
  })

  it('模型独有命令保留（不在 allowlist，source=model）', async () => {
    const { useCase, runner } = setup()
    runner.script('npm run typecheck', passed('npm run typecheck'))
    runner.script('npm test', passed('npm test'))
    runner.script('npm run lint', passed('npm run lint'))

    const outcome = await useCase.verify(
      makeInput({
        modelVerification: [modelRec('extra-cmd', 'passed')], // extra-cmd 不在 allowlist
      }),
    )

    expect(outcome.status).toBe('passed')
    // extra-cmd 保留（模型自报，source=model）。
    const extra = outcome.verification.find((v) => v.command === 'extra-cmd')
    expect(extra).toBeDefined()
    if (extra) expect(extra.source).toBe('model')
    // allowlist 命令覆盖为系统记录。
    const test = outcome.verification.find((v) => v.command === 'npm test')
    expect(test).toBeDefined()
    if (test) expect(test.source).toBe('system')
  })

  it('模型自报 allowlist 命令全 passed 但系统全 failed → blocked（门禁只认系统记录）', async () => {
    const { useCase, runner } = setup()
    runner.script('npm run typecheck', failed('npm run typecheck'))
    runner.script('npm test', failed('npm test'))
    runner.script('npm run lint', failed('npm run lint'))

    const outcome = await useCase.verify(
      makeInput({
        modelVerification: [
          modelRec('npm run typecheck', 'passed'),
          modelRec('npm test', 'passed'),
          modelRec('npm run lint', 'passed'),
        ],
      }),
    )

    expect(outcome.status).toBe('blocked')
    expect(outcome.failureReason).toContain('failed')
  })
})
