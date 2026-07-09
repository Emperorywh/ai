import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  GitMergeAdapter,
  GlobalDocRepository,
  TaskDocRepository,
  WorktreeAdapter,
} from '../../../src/infrastructure/index.js'
import {
  recoverMerge,
  type IdAllocator,
  type RecoveryPorts,
  type MergeTask,
} from '../../../src/application/index.js'
import type {
  GitMergePort,
  GlobalDocName,
  GlobalDocRepositoryPort,
  TaskDocRepositoryPort,
} from '../../../src/application/ports.js'
import type { TaskId } from '../../../src/core/index.js'

/* ============================================================ *
 * 夹具：临时 git 仓库（TESTING.md data 层策略，复用 rebase-ff 测试的构造方式）
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
  writeFileSync(join(repoDir, '.gitignore'), '.worktrees/\nnode_modules/\n')
  gitOk(['add', '.gitignore'], repoDir)
  gitOk(['commit', '-m', 'chore: gitignore'], repoDir)
}

/** 按 taskId 路由到对应 worktree 的 docs/tasks 的文档 port（模拟 CLI wiring，ISS-009）。 */
function worktreeDocs(wtRoot: string): TaskDocRepositoryPort {
  const repoFor = (id: TaskId): TaskDocRepository =>
    new TaskDocRepository(join(wtRoot, id, 'docs', 'tasks'))
  return {
    readTask: (id) => repoFor(id).readTask(id),
    writeTask: (task, body) => repoFor(task.id).writeTask(task, body),
    readResult: (id) => repoFor(id).readResult(id),
    writeResult: (result, body) => repoFor(result.task_id).writeResult(result, body),
    readReview: (id) => repoFor(id).readReview(id),
    writeReview: (review, body) => repoFor(review.task_id).writeReview(review, body),
    listTasks: () => [],
  }
}

/** 生成最小合法任务文件内容（通过 TaskFrontmatterSchema）。 */
function taskDoc(id: TaskId, slug: string): string {
  return [
    '---',
    `id: ${id}`,
    `title: ${slug}`,
    'status: reviewing',
    'layer: domain',
    'allowed_paths: []',
    'verification: []',
    'context_pack:',
    '  required_docs: []',
    '  optional_doc_excerpts: []',
    '  source_files: []',
    'workflow_outputs:',
    `  result_file: docs/tasks/${slug}.result.md`,
    'depends_on: []',
    '---',
    '',
    `# ${id}`,
    '',
  ].join('\n')
}

/** 生成最小合法 .result.md 内容（通过 ResultFrontmatterSchema，execution_commits 留空待回填）。 */
function resultDoc(id: TaskId): string {
  return [
    '---',
    `task_id: ${id}`,
    'execution_status: completed',
    'modified_files: []',
    'created_files: []',
    'deleted_files: []',
    'verification: []',
    'global_update_requests:',
    '  progress: []',
    '  decisions: []',
    '  issues: []',
    'next_action: review',
    '---',
    '',
    `# ${id} 执行结果`,
    '',
  ].join('\n')
}

/** 在主仓库提交任务文件 + 空壳 .result.md（模拟 Orchestrator task:create 产出）。 */
function commitTaskDef(repoDir: string, id: TaskId, slug: string): void {
  mkdirSync(join(repoDir, 'docs', 'tasks'), { recursive: true })
  writeFileSync(join(repoDir, 'docs', 'tasks', `${slug}.md`), taskDoc(id, slug))
  writeFileSync(join(repoDir, 'docs', 'tasks', `${slug}.result.md`), resultDoc(id))
  gitOk(['add', 'docs'], repoDir)
  gitOk(['commit', '-m', `chore: 任务定义 ${id}`], repoDir)
}

/** 在 worktree 内产出一个实现 commit（源码改动）。 */
function implCommit(wtPath: string, file: string, content: string, message: string): void {
  mkdirSync(join(wtPath, 'src'), { recursive: true })
  writeFileSync(join(wtPath, 'src', file), content)
  gitOk(['add', 'src'], wtPath)
  gitOk(['commit', '-m', message], wtPath)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'recovery-test-'))
  initRepo(root)
  worktreesDir = join(root, '.worktrees')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/* ============================================================ *
 * 夹具：全局文档内存 Port + id 分配器 + 调用记录 git 包装（复用 section-writeback 模式）
 * ============================================================ */

const PROGRESS_SEED = [
  '---',
  'doc: PROGRESS',
  'status: active',
  '---',
  '',
  '# PROGRESS',
  '',
  '## 当前完成到哪个任务',
  '',
  '初始状态。',
  '',
  '## 当前系统可用能力',
  '',
  '无。',
  '',
].join('\n')

const DECISIONS_SEED = ['---', 'doc: DECISIONS', 'status: active', '---', '', '# DECISIONS', ''].join('\n')

const ISSUES_SEED = ['---', 'doc: ISSUES', 'status: active', '---', '', '# ISSUES', ''].join('\n')

/**
 * 内存版 GlobalDocRepositoryPort：文件 I/O 走内存 store，正文变换委托真实 GlobalDocRepository
 * （复用 TASK-012 原语，不重复实现）。writes 记录被写回的文档名，供断言「补回写已写盘」。
 */
function memGlobalRepo(): GlobalDocRepositoryPort & { writes: Set<GlobalDocName> } {
  const store: Record<GlobalDocName, string> = {
    progress: PROGRESS_SEED,
    decisions: DECISIONS_SEED,
    issues: ISSUES_SEED,
  }
  const writes = new Set<GlobalDocName>()
  const repo = new GlobalDocRepository()
  return {
    readGlobalDoc: (name) => store[name],
    writeGlobalDoc: (name, content) => {
      store[name] = content
      writes.add(name)
    },
    applyProgressUpdate: (doc, update) => repo.applyProgressUpdate(doc, update),
    appendDecision: (doc, decision) => repo.appendDecision(doc, decision),
    appendIssue: (doc, issue) => repo.appendIssue(doc, issue),
    readDecisions: (doc) => repo.readDecisions(doc),
    readIssues: (doc) => repo.readIssues(doc),
    writes,
  }
}

/** 纯函数式 id 分配器：从 usedIds 中同前缀最大编号 +1（与 section-writeback 测试一致）。 */
function sequentialAllocator(): IdAllocator {
  const next = (used: ReadonlySet<string>, prefix: 'DEC' | 'ISS'): string => {
    const re = prefix === 'DEC' ? /^DEC-(\d+)$/ : /^ISS-(\d+)$/
    let max = 0
    for (const id of used) {
      const m = re.exec(id)
      if (m !== null && m[1] !== undefined) max = Math.max(max, Number(m[1]))
    }
    return `${prefix}-${String(max + 1).padStart(3, '0')}`
  }
  return {
    nextDecisionId: (used) => next(used, 'DEC'),
    nextIssueId: (used) => next(used, 'ISS'),
  }
}

/**
 * 记录型 GitMergePort：委托真实 GitMergeAdapter，同时按调用顺序记录方法名，供断言
 * 「跳过合并时未 rebase」「未合并时先 abort」「二次恢复未重复合并」。
 */
function recordingGit(inner: GitMergePort): GitMergePort & { calls: string[] } {
  const calls: string[] = []
  return {
    rebaseOnto: (id, ref) => {
      calls.push('rebaseOnto')
      return inner.rebaseOnto(id, ref)
    },
    fastForwardMain: (id, ref) => {
      calls.push('fastForwardMain')
      return inner.fastForwardMain(id, ref)
    },
    collectPostRebaseCommits: (id, ref) => {
      calls.push('collectPostRebaseCommits')
      return inner.collectPostRebaseCommits(id, ref)
    },
    commitAuditResult: (id, path) => {
      calls.push('commitAuditResult')
      return inner.commitAuditResult(id, path)
    },
    branchMerged: (id, ref) => {
      calls.push('branchMerged')
      return inner.branchMerged(id, ref)
    },
    abortOrCleanRebase: (id) => {
      calls.push('abortOrCleanRebase')
      return inner.abortOrCleanRebase(id)
    },
    listConflicts: (id) => {
      calls.push('listConflicts')
      return inner.listConflicts(id)
    },
    calls,
  }
}

/** worktree 内是否处于 rebase 中间态（rebase-merge / rebase-apply 目录存在）。 */
function rebaseInProgress(wtPath: string): boolean {
  for (const name of ['rebase-merge', 'rebase-apply']) {
    const dir = gitOk(['rev-parse', '--git-path', name], wtPath)
    // worktree 下 git rev-parse --git-path 返回的是绝对路径（指向主仓库 .git/worktrees/<id>/），
    // 用 resolve 而非 join：dir 为绝对路径时 resolve 直接采用，join 会错拼（对齐 infra
    // isRebaseInProgress 的判定方式）。
    if (dir !== '' && existsSync(resolve(wtPath, dir))) return true
  }
  return false
}

const TASK: MergeTask = {
  id: 'TASK-001',
  depends_on: [],
  workflow_outputs: { result_file: 'docs/tasks/TASK-001-impl.result.md' },
}

/** 单任务 progress replace 回写请求（合并完成时补回写，便于断言已写盘）。 */
function progressWriteback(taskId: TaskId, content: string) {
  return {
    task_id: taskId,
    updates: {
      progress: [{ section: '当前完成到哪个任务', mode: 'replace' as const, content }],
      decisions: [],
      issues: [],
    },
  }
}

/* ============================================================ *
 * recoverMerge
 * ============================================================ */

describe('recoverMerge', () => {
  it('ff 后崩溃（分支已进 main）：幂等跳过合并、补做回写，不 rebase', () => {
    commitTaskDef(root, 'TASK-001', 'TASK-001-impl')
    const wt = new WorktreeAdapter(root, worktreesDir)
    const adapter = new GitMergeAdapter(root, worktreesDir)
    const docs = worktreeDocs(worktreesDir)
    const wtPath = wt.create('main', 'TASK-001')
    implCommit(wtPath, 'feature.ts', 'export const x = 1\n', 'feat: 实现 feature')

    // 先用裸 adapter 走完整 rebaseAndFastForward（模拟「ff 已完成」），但故意不回写全局文档
    // （= 模拟 ff 后、回写前崩溃）。
    adapter.rebaseOnto('TASK-001', 'main')
    const result = docs.readResult('TASK-001')
    const commits = adapter.collectPostRebaseCommits('TASK-001', 'main')
    docs.writeResult({ ...result, execution_commits: commits })
    adapter.commitAuditResult('TASK-001', TASK.workflow_outputs.result_file)
    adapter.fastForwardMain('TASK-001', 'main')
    const mainHeadBefore = gitOk(['rev-parse', 'main'], root)

    // 恢复：分支已进 main → 跳过合并 + 补回写。
    const git = recordingGit(adapter)
    const globalRepo = memGlobalRepo()
    const ports: RecoveryPorts = { git, docs, globalRepo }
    const outcome = recoverMerge('TASK-001', {
      ports,
      task: TASK,
      mainRef: 'main',
      writebackRequest: progressWriteback('TASK-001', 'TASK-001 恢复回写'),
      idAllocator: sequentialAllocator(),
    })

    // 跳过合并：未 rebase / 未 ff。
    expect(outcome.action).toBe('skipped-merged')
    expect(outcome.mergeResult).toEqual({ ok: true, taskId: 'TASK-001' })
    expect(git.calls).not.toContain('rebaseOnto')
    expect(git.calls).not.toContain('fastForwardMain')
    expect(git.calls).not.toContain('abortOrCleanRebase')
    // main 未被触碰（HEAD 不变）。
    expect(gitOk(['rev-parse', 'main'], root)).toBe(mainHeadBefore)
    // 补回写：PROGRESS 已写盘且含恢复内容。
    expect(globalRepo.writes.has('progress')).toBe(true)
    expect(outcome.writeback?.docs.progress).toContain('TASK-001 恢复回写')
  })

  it('rebase 中途崩溃（冲突停顿留中间态）：丢弃中间态、重 rebase，冲突清单返回不抛断', () => {
    commitTaskDef(root, 'TASK-001', 'TASK-001-impl')
    const wt = new WorktreeAdapter(root, worktreesDir)
    const adapter = new GitMergeAdapter(root, worktreesDir)
    const docs = worktreeDocs(worktreesDir)
    const wtPath = wt.create('main', 'TASK-001')
    implCommit(wtPath, 'feature.ts', 'export const x = 1\n', 'feat: 实现 feature')

    // main 与 worktree 同改 README 不同内容 → rebase 冲突；用裸 adapter 触发 rebase 留下中间态
    // （= 模拟 rebase 中途崩溃，未 abort）。
    writeFileSync(join(root, 'README.md'), '# main changed\n')
    gitOk(['add', 'README.md'], root)
    gitOk(['commit', '-m', 'main: 改 README'], root)
    writeFileSync(join(wtPath, 'README.md'), '# wt changed\n')
    gitOk(['add', 'README.md'], wtPath)
    gitOk(['commit', '-m', 'wt: 改 README'], wtPath)
    adapter.rebaseOnto('TASK-001', 'main')
    // 确认构造出真实 rebase 中间态（§12 要求测试构造真实中间态）。
    expect(rebaseInProgress(wtPath)).toBe(true)
    const mainHeadBefore = gitOk(['rev-parse', 'main'], root)

    // 恢复：未进 main → 先 abort 清中间态 → 重 rebase（仍冲突）→ redone-conflict。
    const git = recordingGit(adapter)
    const globalRepo = memGlobalRepo()
    const ports: RecoveryPorts = { git, docs, globalRepo }
    const outcome = recoverMerge('TASK-001', {
      ports,
      task: TASK,
      mainRef: 'main',
      writebackRequest: progressWriteback('TASK-001', '不应回写'),
      idAllocator: sequentialAllocator(),
    })

    // 丢弃中间态（recovery 主动 abort）+ 重 rebase（rebaseAndFastForward 内 rebaseOnto）。
    expect(outcome.action).toBe('redone-conflict')
    expect(git.calls).toContain('abortOrCleanRebase')
    expect(git.calls).toContain('rebaseOnto')
    // 冲突清单返回，不抛断。
    expect(outcome.mergeResult.ok).toBe(false)
    if (!outcome.mergeResult.ok) {
      expect(outcome.mergeResult.conflicts).toContain('README.md')
    }
    // rebase 中间态已清理干净。
    expect(rebaseInProgress(wtPath)).toBe(false)
    // main 未被破坏，分支未进 main。
    expect(gitOk(['rev-parse', 'main'], root)).toBe(mainHeadBefore)
    expect(adapter.branchMerged('TASK-001', 'main')).toBe(false)
    // 冲突不回写。
    expect(outcome.writeback).toBe(null)
    expect(globalRepo.writes.has('progress')).toBe(false)
  })

  it('合并未完成（分支未进 main、无中间态）：丢弃（no-op）+ 重 rebase 成功，补回写', () => {
    commitTaskDef(root, 'TASK-001', 'TASK-001-impl')
    const wt = new WorktreeAdapter(root, worktreesDir)
    const adapter = new GitMergeAdapter(root, worktreesDir)
    const docs = worktreeDocs(worktreesDir)
    const wtPath = wt.create('main', 'TASK-001')
    implCommit(wtPath, 'feature.ts', 'export const x = 1\n', 'feat: 实现 feature')
    // 不做任何合并操作（= 模拟 ff 前 / 合并尚未开始即崩溃）：分支未进 main、无 rebase 中间态。
    expect(adapter.branchMerged('TASK-001', 'main')).toBe(false)

    const git = recordingGit(adapter)
    const globalRepo = memGlobalRepo()
    const ports: RecoveryPorts = { git, docs, globalRepo }
    const outcome = recoverMerge('TASK-001', {
      ports,
      task: TASK,
      mainRef: 'main',
      writebackRequest: progressWriteback('TASK-001', 'TASK-001 重合并回写'),
      idAllocator: sequentialAllocator(),
    })

    // 重 rebase 成功进入 main + 补回写。
    expect(outcome.action).toBe('redone-merged')
    expect(outcome.mergeResult.ok).toBe(true)
    // 未合并时一律先 abort（此处无中间态为 no-op）再重 rebase。
    expect(git.calls).toContain('abortOrCleanRebase')
    expect(git.calls).toContain('rebaseOnto')
    expect(git.calls).toContain('fastForwardMain')
    // 分支已进 main，main 无 merge commit。
    expect(adapter.branchMerged('TASK-001', 'main')).toBe(true)
    expect(gitOk(['log', '--merges', '--oneline', 'main'], root)).toBe('')
    // execution_commits 已回填（只含实现 commit）。
    expect(docs.readResult('TASK-001').execution_commits[0]?.message).toBe('feat: 实现 feature')
    // 补回写。
    expect(globalRepo.writes.has('progress')).toBe(true)
    expect(outcome.writeback?.docs.progress).toContain('TASK-001 重合并回写')
  })

  it('二次恢复幂等（不重复合并）：redone 后再恢复命中已进 main，跳过合并不重 rebase', () => {
    commitTaskDef(root, 'TASK-001', 'TASK-001-impl')
    const wt = new WorktreeAdapter(root, worktreesDir)
    const adapter = new GitMergeAdapter(root, worktreesDir)
    const docs = worktreeDocs(worktreesDir)
    const wtPath = wt.create('main', 'TASK-001')
    implCommit(wtPath, 'feature.ts', 'export const x = 1\n', 'feat: 实现 feature')

    // 第一次恢复：未进 main → 重合并成功。
    const git = recordingGit(adapter)
    const ports: RecoveryPorts = { git, docs, globalRepo: memGlobalRepo() }
    const first = recoverMerge('TASK-001', {
      ports,
      task: TASK,
      mainRef: 'main',
      writebackRequest: progressWriteback('TASK-001', '第一次'),
      idAllocator: sequentialAllocator(),
    })
    expect(first.action).toBe('redone-merged')
    const rebaseCountAfterFirst = git.calls.filter((c) => c === 'rebaseOnto').length
    expect(rebaseCountAfterFirst).toBe(1)
    const mainHeadAfterFirst = gitOk(['rev-parse', 'main'], root)

    // 第二次恢复：已进 main → 跳过合并（不重 rebase / 不重 ff）。
    const second = recoverMerge('TASK-001', {
      ports,
      task: TASK,
      mainRef: 'main',
      writebackRequest: progressWriteback('TASK-001', '第二次'),
      idAllocator: sequentialAllocator(),
    })
    expect(second.action).toBe('skipped-merged')
    // rebaseOnto 调用次数不增加（仍是第一次那 1 次）。
    expect(git.calls.filter((c) => c === 'rebaseOnto').length).toBe(rebaseCountAfterFirst)
    expect(git.calls.filter((c) => c === 'fastForwardMain').length).toBe(1)
    // main HEAD 不变（未重复合并）。
    expect(gitOk(['rev-parse', 'main'], root)).toBe(mainHeadAfterFirst)
  })

  it('taskId 与 task.id 不一致抛错（不静默）', () => {
    const adapter = new GitMergeAdapter(root, worktreesDir)
    const docs = worktreeDocs(worktreesDir)
    const ports: RecoveryPorts = { git: adapter, docs, globalRepo: memGlobalRepo() }
    expect(() =>
      recoverMerge('TASK-999', {
        ports,
        task: TASK,
        mainRef: 'main',
        writebackRequest: progressWriteback('TASK-001', 'x'),
        idAllocator: sequentialAllocator(),
      }),
    ).toThrow(/不一致/)
  })
})
