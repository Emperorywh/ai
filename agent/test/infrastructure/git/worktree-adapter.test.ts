import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  GitAdapterError,
  GitMergeAdapter,
  WorktreeAdapter,
} from '../../../src/infrastructure/index.js'

/* ============================================================ *
 * 夹具：临时 git 仓库（TESTING.md data 层策略）
 * ============================================================ */

let root = ''
let worktreesDir = ''

/** 执行 git 命令并返回原始结果（不判定成败），供断言验证 git 状态。 */
function git(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.error) throw r.error
  return { code: r.status ?? -1, stdout: (r.stdout ?? '').trim(), stderr: r.stderr ?? '' }
}

/** 执行 git 命令，退出码非 0 抛错（夹具准备用）。 */
function gitOk(args: string[], cwd: string): string {
  const r = git(args, cwd)
  if (r.code !== 0) {
    throw new Error(`git ${args.join(' ')} 失败（${r.code}）：${r.stderr}`)
  }
  return r.stdout
}

/** 初始化一个带初始提交的 main 分支临时仓库，并排除 worktree 目录与 node_modules。 */
function initRepo(repoDir: string): void {
  gitOk(['init', '-b', 'main'], repoDir)
  gitOk(['config', 'user.email', 'executor@example.com'], repoDir)
  gitOk(['config', 'user.name', 'Executor'], repoDir)
  writeFileSync(join(repoDir, 'README.md'), '# init\n')
  gitOk(['add', 'README.md'], repoDir)
  gitOk(['commit', '-m', 'init: 初始提交'], repoDir)
  // .worktrees/ 避免主工作区追踪 worktree；node_modules/ 模拟依赖目录（§12 clean 保留）。
  appendFileSync(join(repoDir, '.git', 'info', 'exclude'), '\n.worktrees/\nnode_modules/\n')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wt-test-'))
  initRepo(root)
  worktreesDir = join(root, '.worktrees')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/* ============================================================ *
 * WorktreeAdapter
 * ============================================================ */

describe('WorktreeAdapter', () => {
  it('create 基于 main 基线产出有效 worktree + 分支 task/TASK-XXX', () => {
    const adapter = new WorktreeAdapter(root, worktreesDir)
    const wtPath = adapter.create('main', 'TASK-018')

    // 返回 worktree 绝对路径且目录存在。
    expect(wtPath).toBe(resolve(worktreesDir, 'TASK-018'))
    expect(existsSync(wtPath)).toBe(true)
    // 主仓库 worktree list 含该路径（git 在 Windows 输出正斜杠，统一规范化比较）。
    const norm = (p: string): string => p.replace(/\\/g, '/')
    expect(norm(gitOk(['worktree', 'list'], root))).toContain(norm(wtPath))
    // 分支 task/TASK-018 存在。
    expect(git(['rev-parse', '--verify', 'refs/heads/task/TASK-018'], root).code).toBe(0)
    // worktree 当前 HEAD 指向 task/TASK-018。
    expect(gitOk(['rev-parse', '--abbrev-ref', 'HEAD'], wtPath)).toBe('task/TASK-018')
  })

  it('create 基线固定：main 后续前进不影响 worktree HEAD（reset 依赖此基线）', () => {
    const adapter = new WorktreeAdapter(root, worktreesDir)
    const baseHead = gitOk(['rev-parse', 'main'], root)
    const wtPath = adapter.create('main', 'TASK-018')

    // main 前进。
    writeFileSync(join(root, 'main-file.txt'), 'main\n')
    gitOk(['add', 'main-file.txt'], root)
    gitOk(['commit', '-m', 'main: 前进'], root)

    expect(gitOk(['rev-parse', 'HEAD'], wtPath)).toBe(baseHead)
  })

  it('reset 回到 create 记录的基线，丢弃 worktree 上的执行 commit 与未跟踪文件', () => {
    const adapter = new WorktreeAdapter(root, worktreesDir)
    const wtPath = adapter.create('main', 'TASK-018')
    const baseHead = gitOk(['rev-parse', 'HEAD'], wtPath)

    // worktree 上产生执行 commit + 未跟踪文件。
    writeFileSync(join(wtPath, 'feature.txt'), 'x\n')
    gitOk(['add', 'feature.txt'], wtPath)
    gitOk(['commit', '-m', 'feat: 实现'], wtPath)
    writeFileSync(join(wtPath, 'untracked.txt'), 'y\n')

    expect(gitOk(['rev-parse', 'HEAD'], wtPath)).not.toBe(baseHead)
    adapter.reset('TASK-018')

    // HEAD 回到基线，执行产物与未跟踪文件均被清除。
    expect(gitOk(['rev-parse', 'HEAD'], wtPath)).toBe(baseHead)
    expect(existsSync(join(wtPath, 'feature.txt'))).toBe(false)
    expect(existsSync(join(wtPath, 'untracked.txt'))).toBe(false)
  })

  it('reset 保留被忽略文件（node_modules 不被 clean 清除，§12）', () => {
    const adapter = new WorktreeAdapter(root, worktreesDir)
    const wtPath = adapter.create('main', 'TASK-018')

    // node_modules 被 .git/info/exclude 忽略（依赖目录，非本适配器职责，§12）。
    mkdirSync(join(wtPath, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(wtPath, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n')

    adapter.reset('TASK-018')
    // clean -fd 保留被忽略文件（不用 -x）。
    expect(existsSync(join(wtPath, 'node_modules', 'pkg', 'index.js'))).toBe(true)
  })

  it('reset 未由本适配器 create 的 taskId 抛错（无法确定基线）', () => {
    const adapter = new WorktreeAdapter(root, worktreesDir)
    expect(() => adapter.reset('TASK-999')).toThrow(/无法确定重置基线/)
  })

  it('retain 显式保留 worktree 与分支（no-op，不删除）', () => {
    const adapter = new WorktreeAdapter(root, worktreesDir)
    const wtPath = adapter.create('main', 'TASK-018')
    adapter.retain('TASK-018')
    expect(existsSync(wtPath)).toBe(true)
    expect(git(['rev-parse', '--verify', 'refs/heads/task/TASK-018'], root).code).toBe(0)
  })

  it('remove 回收 worktree 与分支', () => {
    const adapter = new WorktreeAdapter(root, worktreesDir)
    const wtPath = adapter.create('main', 'TASK-018')
    adapter.remove('TASK-018')
    expect(existsSync(wtPath)).toBe(false)
    expect(git(['rev-parse', '--verify', 'refs/heads/task/TASK-018'], root).code).not.toBe(0)
  })

  it('remove 幂等（重复调用 / 手动清理后不抛错）', () => {
    const adapter = new WorktreeAdapter(root, worktreesDir)
    adapter.create('main', 'TASK-018')
    adapter.remove('TASK-018')
    expect(() => adapter.remove('TASK-018')).not.toThrow()
  })
})

/* ============================================================ *
 * GitMergeAdapter
 * ============================================================ */

describe('GitMergeAdapter', () => {
  it('rebaseOnto 把 worktree 分支 rebase 到最新 main（无冲突场景）', () => {
    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    const wtPath = wt.create('main', 'TASK-018')

    // main 前进（不同文件，避免冲突）。
    writeFileSync(join(root, 'main-file.txt'), 'main\n')
    gitOk(['add', 'main-file.txt'], root)
    gitOk(['commit', '-m', 'main: 新增文件'], root)
    // worktree 产生实现 commit。
    writeFileSync(join(wtPath, 'wt-file.txt'), 'wt\n')
    gitOk(['add', 'wt-file.txt'], wtPath)
    gitOk(['commit', '-m', 'feat: worktree 实现'], wtPath)

    merge.rebaseOnto('TASK-018', 'main')

    // rebase 后 worktree 同时含 main 新文件与 worktree 实现。
    expect(existsSync(join(wtPath, 'main-file.txt'))).toBe(true)
    expect(existsSync(join(wtPath, 'wt-file.txt'))).toBe(true)
  })

  it('rebaseOnto 遇冲突不抛断，留 listConflicts 探测', () => {
    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    const wtPath = wt.create('main', 'TASK-018')

    // 同一文件双方各改不同内容 → rebase 冲突。
    writeFileSync(join(root, 'README.md'), '# main changed\n')
    gitOk(['add', 'README.md'], root)
    gitOk(['commit', '-m', 'main: 改 README'], root)
    writeFileSync(join(wtPath, 'README.md'), '# wt changed\n')
    gitOk(['add', 'README.md'], wtPath)
    gitOk(['commit', '-m', 'wt: 改 README'], wtPath)

    expect(() => merge.rebaseOnto('TASK-018', 'main')).not.toThrow()
    expect(merge.listConflicts('TASK-018')).toContain('README.md')
  })

  it('fastForwardMain 把分支快进到 main 且不产生 merge commit', () => {
    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    const wtPath = wt.create('main', 'TASK-018')

    writeFileSync(join(wtPath, 'feature.txt'), 'x\n')
    gitOk(['add', 'feature.txt'], wtPath)
    gitOk(['commit', '-m', 'feat: 实现'], wtPath)
    const branchHead = gitOk(['rev-parse', 'task/TASK-018'], root)

    merge.fastForwardMain('TASK-018', 'main')

    // main 指向 branch HEAD（快进）。
    expect(gitOk(['rev-parse', 'main'], root)).toBe(branchHead)
    // 无 merge commit。
    expect(gitOk(['log', '--merges', '--oneline', 'main'], root)).toBe('')
  })

  it('fastForwardMain 分叉时抛 GitAdapterError（不可快进，需先 rebase）', () => {
    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    const wtPath = wt.create('main', 'TASK-018')

    // worktree 加 commit。
    writeFileSync(join(wtPath, 'wt.txt'), 'x\n')
    gitOk(['add', 'wt.txt'], wtPath)
    gitOk(['commit', '-m', 'wt: 实现'], wtPath)
    // main 也加 commit → 分叉。
    writeFileSync(join(root, 'main.txt'), 'm\n')
    gitOk(['add', 'main.txt'], root)
    gitOk(['commit', '-m', 'main: 前进'], root)

    expect(() => merge.fastForwardMain('TASK-018', 'main')).toThrow(GitAdapterError)
  })

  it('collectPostRebaseCommits 采集 post-rebase 实现 commit 的 hash/message/author/time', () => {
    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    const wtPath = wt.create('main', 'TASK-018')

    writeFileSync(join(wtPath, 'a.txt'), 'a\n')
    gitOk(['add', 'a.txt'], wtPath)
    gitOk(['commit', '-m', 'feat: a'], wtPath)
    writeFileSync(join(wtPath, 'b.txt'), 'b\n')
    gitOk(['add', 'b.txt'], wtPath)
    gitOk(['commit', '-m', 'feat: b'], wtPath)

    const commits = merge.collectPostRebaseCommits('TASK-018', 'main')

    expect(commits).toHaveLength(2)
    // --reverse 按提交时间正序（旧→新）。
    expect(commits[0]?.message).toBe('feat: a')
    expect(commits[1]?.message).toBe('feat: b')
    // hash 与 git log 一致。
    const logHashes = gitOk(['log', 'main..HEAD', '--reverse', '--format=%H'], wtPath).split('\n')
    expect(commits[0]?.hash).toBe(logHashes[0] ?? '')
    expect(commits[1]?.hash).toBe(logHashes[1] ?? '')
    // author / time 非空且符合 git 输出。
    expect(commits[0]?.author).toBe('Executor')
    expect(commits[0]?.time).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('collectPostRebaseCommits 必须在 commitAuditResult 之前调用（audit commit 不计入）', () => {
    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    const wtPath = wt.create('main', 'TASK-018')

    // 实现 commit。
    writeFileSync(join(wtPath, 'impl.txt'), 'x\n')
    gitOk(['add', 'impl.txt'], wtPath)
    gitOk(['commit', '-m', 'feat: 实现'], wtPath)

    // §3.2 顺序：rebase 后、audit commit 前采集 → 只含实现 commit。
    const beforeAudit = merge.collectPostRebaseCommits('TASK-018', 'main')
    expect(beforeAudit).toHaveLength(1)
    expect(beforeAudit[0]?.message).toBe('feat: 实现')

    // 提交 audit commit（§3.2 独立记录载体）。
    mkdirSync(join(wtPath, 'docs', 'tasks'), { recursive: true })
    writeFileSync(join(wtPath, 'docs', 'tasks', 'TASK-018.result.md'), '---\ntask_id: TASK-018\n---\n')
    merge.commitAuditResult('TASK-018', 'docs/tasks/TASK-018.result.md')

    // audit commit 之后再采集会含 audit commit —— 印证 collect 时序约定。
    const afterAudit = merge.collectPostRebaseCommits('TASK-018', 'main')
    expect(afterAudit.some((c) => c.message.includes('workflow-audit'))).toBe(true)
  })

  it('commitAuditResult 提交独立 workflow audit commit，工作区干净', () => {
    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    const wtPath = wt.create('main', 'TASK-018')

    const resultPath = 'docs/tasks/TASK-018.result.md'
    mkdirSync(join(wtPath, 'docs', 'tasks'), { recursive: true })
    writeFileSync(join(wtPath, resultPath), '---\ntask_id: TASK-018\n---\n')

    merge.commitAuditResult('TASK-018', resultPath)

    const log = gitOk(['log', '-1', '--format=%s'], wtPath)
    expect(log).toContain('workflow-audit')
    expect(log).toContain('TASK-018')
    // 文件已提交，工作区干净。
    expect(gitOk(['status', '--porcelain'], wtPath)).toBe('')
  })

  it('branchMerged 反映分支是否已进入 main（幂等恢复判定）', () => {
    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    const wtPath = wt.create('main', 'TASK-018')

    writeFileSync(join(wtPath, 'f.txt'), 'x\n')
    gitOk(['add', 'f.txt'], wtPath)
    gitOk(['commit', '-m', 'feat: 实现'], wtPath)

    expect(merge.branchMerged('TASK-018', 'main')).toBe(false)
    merge.fastForwardMain('TASK-018', 'main')
    expect(merge.branchMerged('TASK-018', 'main')).toBe(true)
  })

  it('abortOrCleanRebase 清除 rebase 冲突中间态', () => {
    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    const wtPath = wt.create('main', 'TASK-018')

    // 制造 rebase 冲突。
    writeFileSync(join(root, 'README.md'), '# main\n')
    gitOk(['add', 'README.md'], root)
    gitOk(['commit', '-m', 'main: 改 README'], root)
    writeFileSync(join(wtPath, 'README.md'), '# wt\n')
    gitOk(['add', 'README.md'], wtPath)
    gitOk(['commit', '-m', 'wt: 改 README'], wtPath)
    merge.rebaseOnto('TASK-018', 'main') // 冲突停顿，不抛断

    merge.abortOrCleanRebase('TASK-018')

    // rebase 中间态已清除（rebase-merge 目录不存在）。
    const dir = gitOk(['rev-parse', '--git-path', 'rebase-merge'], wtPath)
    expect(existsSync(resolve(wtPath, dir))).toBe(false)
  })

  it('abortOrCleanRebase 无进行中的 rebase 时幂等不抛', () => {
    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    wt.create('main', 'TASK-018')
    expect(() => merge.abortOrCleanRebase('TASK-018')).not.toThrow()
  })

  it('listConflicts 无冲突时返回空数组', () => {
    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    wt.create('main', 'TASK-018')
    expect(merge.listConflicts('TASK-018')).toEqual([])
  })
})
