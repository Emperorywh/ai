/**
 * ProcessVerificationRunner 测试(TASK-040 / SPEC FR-011 / 任务 §11)。
 *
 * 用真实子进程(node -e)覆盖 §11 验收:
 *   - 真实命令的退出码与输出摘要正确写入验证记录。
 *   - spawn 失败、非零退出和中断(超时)均显式返回。
 *   - 输出设上限,超大输出被截断且标注。
 *
 * TESTING.md data 层策略:临时目录作 worktreePath,不依赖项目仓库。
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProcessVerificationRunner } from '../../../src/infrastructure/process/verification-runner.js'

/** 临时 worktree 目录(每用例独立,避免状态残留)。 */
function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `runner-${prefix}-`))
}

/** 跨平台 node 命令封装(worktreePath 内执行,shell:true 下 node 经 PATH 找到)。 */
function node(script: string): string {
  return `node -e ${JSON.stringify(script)}`
}

/* ============================================================ *
 * 退出码采集
 * ============================================================ */

describe('ProcessVerificationRunner — 退出码采集', () => {
  it('退出码 0 → result=passed, exitCode=0', async () => {
    const wt = tempDir('ok')
    try {
      const runner = new ProcessVerificationRunner()
      const r = await runner.run({ command: node('process.exit(0)'), worktreePath: wt })
      expect(r.result).toBe('passed')
      expect(r.exitCode).toBe(0)
      expect(r.durationMs).toBeGreaterThanOrEqual(0)
      expect(r.command).toBe(node('process.exit(0)'))
    } finally {
      rmSync(wt, { recursive: true, force: true })
    }
  })

  it('退出码非 0 → result=failed, exitCode=真实退出码', async () => {
    const wt = tempDir('fail')
    try {
      const runner = new ProcessVerificationRunner()
      const r = await runner.run({ command: node('process.exit(3)'), worktreePath: wt })
      expect(r.result).toBe('failed')
      expect(r.exitCode).toBe(3)
    } finally {
      rmSync(wt, { recursive: true, force: true })
    }
  })

  it('命令抛未捕获异常 → 非零退出 → failed', async () => {
    const wt = tempDir('throw')
    try {
      const runner = new ProcessVerificationRunner()
      const r = await runner.run({
        command: node('throw new Error("boom")'),
        worktreePath: wt,
      })
      expect(r.result).toBe('failed')
      expect(r.exitCode).not.toBe(0)
      expect(r.exitCode).not.toBeNull() // node 未捕获异常退出码 1
    } finally {
      rmSync(wt, { recursive: true, force: true })
    }
  })
})

/* ============================================================ *
 * stdout / stderr 摘要采集
 * ============================================================ */

describe('ProcessVerificationRunner — 输出摘要采集', () => {
  it('stdout 内容写入 outputSummary', async () => {
    const wt = tempDir('stdout')
    try {
      const runner = new ProcessVerificationRunner()
      const r = await runner.run({
        command: node("console.log('hello-stdout')"),
        worktreePath: wt,
      })
      expect(r.result).toBe('passed')
      expect(r.outputSummary).toContain('hello-stdout')
      expect(r.outputSummary).toContain('stdout')
    } finally {
      rmSync(wt, { recursive: true, force: true })
    }
  })

  it('stderr 内容写入 outputSummary', async () => {
    const wt = tempDir('stderr')
    try {
      const runner = new ProcessVerificationRunner()
      const r = await runner.run({
        command: node("console.error('hello-stderr')"),
        worktreePath: wt,
      })
      // console.error 不导致非零退出 → passed。
      expect(r.result).toBe('passed')
      expect(r.outputSummary).toContain('hello-stderr')
      expect(r.outputSummary).toContain('stderr')
    } finally {
      rmSync(wt, { recursive: true, force: true })
    }
  })

  it('无输出命令 → outputSummary 为空串', async () => {
    const wt = tempDir('silent')
    try {
      const runner = new ProcessVerificationRunner()
      const r = await runner.run({ command: node('process.exit(0)'), worktreePath: wt })
      expect(r.outputSummary).toBe('')
    } finally {
      rmSync(wt, { recursive: true, force: true })
    }
  })

  it('超大 stdout 被截断并标注(maxOutputBytes 上限)', async () => {
    const wt = tempDir('trunc')
    try {
      // maxOutputBytes=10 → 1000 字符 stdout 截断到 10。
      const runner = new ProcessVerificationRunner({ maxOutputBytes: 10 })
      const r = await runner.run({
        command: node("console.log('a'.repeat(1000))"),
        worktreePath: wt,
      })
      expect(r.outputSummary).toContain('[截断]')
      // 截断后 stdout 段不超过上限 + 标记(1000 字符不进入摘要)。
      expect(r.outputSummary.length).toBeLessThan(100)
    } finally {
      rmSync(wt, { recursive: true, force: true })
    }
  })
})

/* ============================================================ *
 * spawn 失败 + 超时(显式返回,不静默)
 * ============================================================ */

describe('ProcessVerificationRunner — spawn 失败与超时', () => {
  it('cwd 不存在 → spawn error → failed + exitCode=null + 摘要含启动失败', async () => {
    const runner = new ProcessVerificationRunner()
    const r = await runner.run({
      command: node("console.log('x')"),
      worktreePath: join(tmpdir(), 'definitely-nonexistent-runner-cwd-xyz'),
    })
    expect(r.result).toBe('failed')
    expect(r.exitCode).toBeNull()
    expect(r.outputSummary).toContain('启动失败')
  })

  it('超时 → failed + exitCode=null + 摘要含超时 + 进程被强制终止', async () => {
    const wt = tempDir('timeout')
    try {
      // timeoutMs=150:命令远超超时 → 触发超时收口;命令自退时长短以减少孤儿进程残留。
      const runner = new ProcessVerificationRunner({ timeoutMs: 150 })
      const r = await runner.run({
        command: node('setTimeout(()=>{}, 10000)'),
        worktreePath: wt,
      })
      expect(r.result).toBe('failed')
      expect(r.exitCode).toBeNull()
      expect(r.outputSummary).toContain('超时')
      // 超时映射应在合理时间内返回(非 100s)。
      expect(r.durationMs).toBeLessThan(5_000)
    } finally {
      rmSync(wt, { recursive: true, force: true })
    }
  })
})

/* ============================================================ *
 * name + 接口契约
 * ============================================================ */

describe('ProcessVerificationRunner — 契约', () => {
  it('name = process-runner', () => {
    expect(new ProcessVerificationRunner().name).toBe('process-runner')
  })

  it('run 返回结构满足 VerificationRunnerResult 四元组', async () => {
    const wt = tempDir('contract')
    try {
      const runner = new ProcessVerificationRunner()
      const r = await runner.run({ command: node('process.exit(0)'), worktreePath: wt })
      expect(r).toHaveProperty('command')
      expect(r).toHaveProperty('result')
      expect(r).toHaveProperty('exitCode')
      expect(r).toHaveProperty('durationMs')
      expect(r).toHaveProperty('outputSummary')
      expect(typeof r.durationMs).toBe('number')
      expect(typeof r.outputSummary).toBe('string')
    } finally {
      rmSync(wt, { recursive: true, force: true })
    }
  })
})
