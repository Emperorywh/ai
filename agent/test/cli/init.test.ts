import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DOC_FILES, scaffoldProject } from '../../src/cli/commands/init.js'
import { CliExitCode, runCli } from '../../src/cli/framework.js'

/* init 生成的全部相对路径（单一来源派生，避免与模板清单脱节）。 */
const EXPECTED_PATHS = DOC_FILES.map((f) => f.path)
const DOC_DOC_PATHS = EXPECTED_PATHS.filter((p) => p.startsWith('docs/'))

describe('init 命令 — scaffoldProject', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'caw-init-'))
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('生成 §6 全部文档与 docs/tasks/ 目录', () => {
    const result = scaffoldProject(projectDir)

    for (const rel of EXPECTED_PATHS) {
      expect(existsSync(join(projectDir, rel)), `${rel} 应存在`).toBe(true)
    }
    // docs/tasks/ 目录随 .gitkeep 写入被建立
    expect(existsSync(join(projectDir, 'docs', 'tasks'))).toBe(true)
    expect(statSync(join(projectDir, 'docs', 'tasks')).isDirectory()).toBe(true)

    expect(result.created.slice().sort()).toEqual(EXPECTED_PATHS.slice().sort())
    expect(result.skipped).toEqual([])
    expect(result.projectRoot).toBe(resolve(projectDir))
  })

  it('AGENTS.md 模板含 §6.1 通用约束项', () => {
    scaffoldProject(projectDir)
    const agents = readFileSync(join(projectDir, 'AGENTS.md'), 'utf8')
    // §6.1 列出的约束关键词
    expect(agents).toContain('简体中文')
    expect(agents).toContain('不跨层调用')
    expect(agents).toContain('不写巨型函数')
    expect(agents).toContain('不制造隐式状态')
    expect(agents).toContain('不引入临时 patch')
  })

  it('幂等：重复执行不覆盖既有文件', () => {
    scaffoldProject(projectDir)
    // 篡改一个文件，验证第二次绝不覆盖
    const agentsPath = join(projectDir, 'AGENTS.md')
    const marker = '# 用户自定义内容，不应被覆盖'
    writeFileSync(agentsPath, marker, 'utf8')

    const result2 = scaffoldProject(projectDir)

    expect(result2.created).toEqual([])
    expect(result2.skipped.slice().sort()).toEqual(EXPECTED_PATHS.slice().sort())
    expect(readFileSync(agentsPath, 'utf8')).toBe(marker)
  })

  it('目标路径已存在且是文件时抛错', () => {
    const filePath = join(projectDir, 'a-blocker-file')
    writeFileSync(filePath, 'x', 'utf8')
    expect(() => scaffoldProject(filePath)).toThrow()
  })

  it('仅写文档骨架，不创建 docs/ 以外的无关文件', () => {
    const result = scaffoldProject(projectDir)
    // created 全部落于约定清单内，不越界写源码 / 配置
    for (const p of result.created) {
      expect(EXPECTED_PATHS, `意外创建 ${p}`).toContain(p)
    }
    // docs/ 下文件数恰为清单声明数（SPEC/ARCHITECTURE/PLAN/PROGRESS/DECISIONS/ISSUES/TESTING + tasks/.gitkeep）
    expect(DOC_DOC_PATHS.length).toBe(8)
  })
})

describe('init 命令 — runCli（退出码约定）', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'caw-init-'))
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('init <dir> 生成骨架并返回成功退出码', async () => {
    const exitCode = await runCli(['init', projectDir])
    expect(exitCode).toBe(CliExitCode.Success)
    for (const rel of EXPECTED_PATHS) {
      expect(existsSync(join(projectDir, rel)), `${rel} 应存在`).toBe(true)
    }
  })

  it('init <dir> 对已有目录幂等（跳过，仍成功）', async () => {
    await runCli(['init', projectDir])
    const exitCode2 = await runCli(['init', projectDir])
    expect(exitCode2).toBe(CliExitCode.Success)
  })

  it('--help 返回成功退出码', async () => {
    const exitCode = await runCli(['--help'])
    expect(exitCode).toBe(CliExitCode.Success)
  })

  it('未知命令返回非零退出码', async () => {
    const exitCode = await runCli(['nonexistent-command'])
    expect(exitCode).not.toBe(CliExitCode.Success)
  })
})
