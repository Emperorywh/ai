import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  GitMergeAdapter,
  TaskDocRepository,
  WorktreeAdapter,
} from '../../../src/infrastructure/index.js'
import {
  rebaseAndFastForward,
  type MergePorts,
  type MergeTask,
} from '../../../src/application/index.js'
import type { TaskDocRepositoryPort } from '../../../src/application/ports.js'
import type { TaskId } from '../../../src/core/index.js'

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
  writeFileSync(join(repoDir, '.gitignore'), '.worktrees/\nnode_modules/\n')
  gitOk(['add', '.gitignore'], repoDir)
  gitOk(['commit', '-m', 'chore: gitignore'], repoDir)
}

/**
 * 按 taskId 路由到对应 worktree 的 docs/tasks 的文档 port（模拟 CLI wiring）。
 *
 * 真实场景下 .result.md 分布在各任务 worktree 内（Executor 产出），合并逐任务在各自 worktree
 * 进行；GitMergePort 天然按 taskId 经 WorktreePort 寻址 worktree，而 TaskDocRepository 单
 * tasksDir 无法覆盖多 worktree，故 CLI wiring 需组合一个按 taskId 路由的 docs 适配器。本测试
 * 用闭包路由模拟该 wiring，验证编排逻辑（非 wiring 本身，wiring 归 TASK-025/026）。
 */
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
    // 合并不依赖 listTasks，返回空数组占位。
    listTasks: () => [],
  }
}

/** 生成最小合法任务文件内容（通过 TaskFrontmatterSchema）。 */
function taskDoc(id: TaskId, slug: string, dependsOn: readonly TaskId[] = []): string {
  const lines = [
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
    'depends_on:',
  ]
  for (const d of dependsOn) lines.push(`  - ${d}`)
  lines.push('---', '', `# ${id}`, '')
  return lines.join('\n')
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
function commitTaskDefs(repoDir: string, defs: ReadonlyArray<{ id: TaskId; slug: string; dependsOn?: readonly TaskId[] }>): void {
  mkdirSync(join(repoDir, 'docs', 'tasks'), { recursive: true })
  for (const d of defs) {
    writeFileSync(join(repoDir, 'docs', 'tasks', `${d.slug}.md`), taskDoc(d.id, d.slug, d.dependsOn))
    writeFileSync(join(repoDir, 'docs', 'tasks', `${d.slug}.result.md`), resultDoc(d.id))
  }
  gitOk(['add', 'docs'], repoDir)
  gitOk(['commit', '-m', `chore: 任务定义 ${defs.map((d) => d.id).join(' / ')}`], repoDir)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'merge-test-'))
  initRepo(root)
  worktreesDir = join(root, '.worktrees')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/* ============================================================ *
 * rebaseAndFastForward
 * ============================================================ */

describe('rebaseAndFastForward', () => {
  it('单任务成功：rebase + 回填 + audit + ff，main 无 merge commit，execution_commits 不含 audit', () => {
    commitTaskDefs(root, [{ id: 'TASK-001', slug: 'TASK-001-impl' }])

    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    const ports: MergePorts = { git: merge, docs: worktreeDocs(worktreesDir) }
    const wtPath = wt.create('main', 'TASK-001')

    // worktree 内 Executor 产出一个实现 commit（源码改动，.result.md 暂为空壳待回填）。
    mkdirSync(join(wtPath, 'src'), { recursive: true })
    writeFileSync(join(wtPath, 'src', 'feature.ts'), 'export const x = 1\n')
    gitOk(['add', 'src'], wtPath)
    gitOk(['commit', '-m', 'feat: 实现 feature'], wtPath)

    const task: MergeTask = {
      id: 'TASK-001',
      depends_on: [],
      workflow_outputs: { result_file: 'docs/tasks/TASK-001-impl.result.md' },
    }
    const outcome = rebaseAndFastForward(ports, [task], { mainRef: 'main' })

    // 成功合并。
    expect(outcome.merged).toEqual(['TASK-001'])
    expect(outcome.conflicts).toEqual([])
    expect(outcome.skipped).toEqual([])
    // main 无 merge commit（线性快进）。
    expect(gitOk(['log', '--merges', '--oneline', 'main'], root)).toBe('')

    // execution_commits 回填：只含实现 commit，不含 audit commit。
    const result = ports.docs.readResult('TASK-001')
    expect(result.execution_commits).toHaveLength(1)
    expect(result.execution_commits[0]?.message).toBe('feat: 实现 feature')
    expect(result.execution_commits[0]?.author).toBe('Executor')
    expect(result.execution_commits.some((c) => c.message.includes('workflow-audit'))).toBe(false)
    // hash 与 main 中实现 commit 一致（audit commit 是 main HEAD，实现 commit 是 HEAD~1）。
    const implHash = gitOk(['rev-parse', 'main~1'], root)
    expect(result.execution_commits[0]?.hash).toBe(implHash)
  })

  it('多任务按拓扑序串行合并：先合并被依赖方，各自 execution_commits 正确', () => {
    commitTaskDefs(root, [
      { id: 'TASK-001', slug: 'TASK-001-a' },
      { id: 'TASK-002', slug: 'TASK-002-b', dependsOn: ['TASK-001'] },
    ])

    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    const ports: MergePorts = { git: merge, docs: worktreeDocs(worktreesDir) }
    // 两 worktree 均基于初始 main 基线创建，各自产出一个实现 commit（不同文件，无冲突）。
    const wt1 = wt.create('main', 'TASK-001')
    mkdirSync(join(wt1, 'src'), { recursive: true })
    writeFileSync(join(wt1, 'src', 'a.ts'), 'export const a = 1\n')
    gitOk(['add', 'src'], wt1)
    gitOk(['commit', '-m', 'feat: a'], wt1)
    const wt2 = wt.create('main', 'TASK-002')
    mkdirSync(join(wt2, 'src'), { recursive: true })
    writeFileSync(join(wt2, 'src', 'b.ts'), 'export const b = 2\n')
    gitOk(['add', 'src'], wt2)
    gitOk(['commit', '-m', 'feat: b'], wt2)

    const tasks: MergeTask[] = [
      { id: 'TASK-001', depends_on: [], workflow_outputs: { result_file: 'docs/tasks/TASK-001-a.result.md' } },
      { id: 'TASK-002', depends_on: ['TASK-001'], workflow_outputs: { result_file: 'docs/tasks/TASK-002-b.result.md' } },
    ]
    const outcome = rebaseAndFastForward(ports, tasks, { mainRef: 'main' })

    // 拓扑序：被依赖方 TASK-001 在前。
    expect(outcome.merged).toEqual(['TASK-001', 'TASK-002'])
    // main 无 merge commit。
    expect(gitOk(['log', '--merges', '--oneline', 'main'], root)).toBe('')
    // 各自 execution_commits 只含本任务实现 commit。
    expect(ports.docs.readResult('TASK-001').execution_commits[0]?.message).toBe('feat: a')
    expect(ports.docs.readResult('TASK-002').execution_commits[0]?.message).toBe('feat: b')
  })

  it('rebase 冲突返回清单且不破坏 main（不抛断）', () => {
    // 仅提交 TASK-001 任务文件（冲突路径不读 .result.md，但保留任务文件以保持真实）。
    commitTaskDefs(root, [{ id: 'TASK-001', slug: 'TASK-001-impl' }])

    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    const ports: MergePorts = { git: merge, docs: worktreeDocs(worktreesDir) }
    const wtPath = wt.create('main', 'TASK-001')

    // main 与 worktree 同改 README 不同内容 → rebase 冲突。
    writeFileSync(join(root, 'README.md'), '# main changed\n')
    gitOk(['add', 'README.md'], root)
    gitOk(['commit', '-m', 'main: 改 README'], root)
    writeFileSync(join(wtPath, 'README.md'), '# wt changed\n')
    gitOk(['add', 'README.md'], wtPath)
    gitOk(['commit', '-m', 'wt: 改 README'], wtPath)

    const mainBefore = gitOk(['rev-parse', 'main'], root)
    const task: MergeTask = {
      id: 'TASK-001',
      depends_on: [],
      workflow_outputs: { result_file: 'docs/tasks/TASK-001-impl.result.md' },
    }
    const outcome = rebaseAndFastForward(ports, [task], { mainRef: 'main' })

    // 冲突清单返回，不抛断。
    expect(outcome.merged).toEqual([])
    expect(outcome.conflicts).toHaveLength(1)
    expect(outcome.conflicts[0]?.taskId).toBe('TASK-001')
    expect(outcome.conflicts[0]?.conflicts).toContain('README.md')
    // main 未被破坏：HEAD 不变，无 merge commit。
    expect(gitOk(['rev-parse', 'main'], root)).toBe(mainBefore)
    expect(gitOk(['log', '--merges', '--oneline', 'main'], root)).toBe('')
    // rebase 中间态已清理。
    const rebaseDir = gitOk(['rev-parse', '--git-path', 'rebase-merge'], wtPath)
    expect(existsSync(join(wtPath, rebaseDir))).toBe(false)
  })

  it('冲突任务的传递后继连带 skipped（§3.2 不得先于依赖回收）', () => {
    commitTaskDefs(root, [
      { id: 'TASK-001', slug: 'TASK-001-a' },
      { id: 'TASK-002', slug: 'TASK-002-b', dependsOn: ['TASK-001'] },
    ])

    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    const ports: MergePorts = { git: merge, docs: worktreeDocs(worktreesDir) }
    // 仅 TASK-001 制造冲突；TASK-002 skipped 路径不操作 worktree，无需创建。
    const wt1 = wt.create('main', 'TASK-001')
    writeFileSync(join(root, 'README.md'), '# main changed\n')
    gitOk(['add', 'README.md'], root)
    gitOk(['commit', '-m', 'main: 改 README'], root)
    writeFileSync(join(wt1, 'README.md'), '# wt changed\n')
    gitOk(['add', 'README.md'], wt1)
    gitOk(['commit', '-m', 'wt: 改 README'], wt1)

    const tasks: MergeTask[] = [
      { id: 'TASK-001', depends_on: [], workflow_outputs: { result_file: 'docs/tasks/TASK-001-a.result.md' } },
      { id: 'TASK-002', depends_on: ['TASK-001'], workflow_outputs: { result_file: 'docs/tasks/TASK-002-b.result.md' } },
    ]
    const outcome = rebaseAndFastForward(ports, tasks, { mainRef: 'main' })

    // TASK-001 冲突，TASK-002（传递后继）连带 skipped，无任何合并。
    expect(outcome.merged).toEqual([])
    expect(outcome.conflicts.map((c) => c.taskId)).toEqual(['TASK-001'])
    expect(outcome.skipped.map((s) => s.taskId)).toEqual(['TASK-002'])
  })

  it('空任务集合返回空结果', () => {
    const merge = new GitMergeAdapter(root, worktreesDir)
    const ports: MergePorts = { git: merge, docs: worktreeDocs(worktreesDir) }
    const outcome = rebaseAndFastForward(ports, [], { mainRef: 'main' })
    expect(outcome).toEqual({ merged: [], conflicts: [], skipped: [], results: [] })
  })

  it('回填时序：collectPostRebaseCommits 在 commitAuditResult 之前，audit commit 不计入 execution_commits', () => {
    commitTaskDefs(root, [{ id: 'TASK-001', slug: 'TASK-001-impl' }])

    const wt = new WorktreeAdapter(root, worktreesDir)
    const merge = new GitMergeAdapter(root, worktreesDir)
    const ports: MergePorts = { git: merge, docs: worktreeDocs(worktreesDir) }
    const wtPath = wt.create('main', 'TASK-001')

    // 两个实现 commit。
    mkdirSync(join(wtPath, 'src'), { recursive: true })
    writeFileSync(join(wtPath, 'src', 'a.ts'), 'a\n')
    gitOk(['add', 'src'], wtPath)
    gitOk(['commit', '-m', 'feat: a'], wtPath)
    writeFileSync(join(wtPath, 'src', 'b.ts'), 'b\n')
    gitOk(['add', 'src'], wtPath)
    gitOk(['commit', '-m', 'feat: b'], wtPath)

    const task: MergeTask = {
      id: 'TASK-001',
      depends_on: [],
      workflow_outputs: { result_file: 'docs/tasks/TASK-001-impl.result.md' },
    }
    rebaseAndFastForward(ports, [task], { mainRef: 'main' })

    // execution_commits = 两个实现 commit（顺序旧→新），audit commit（main HEAD）不在内。
    const commits = ports.docs.readResult('TASK-001').execution_commits
    expect(commits.map((c) => c.message)).toEqual(['feat: a', 'feat: b'])
    const auditHash = gitOk(['rev-parse', 'main'], root)
    expect(commits.some((c) => c.hash === auditHash)).toBe(false)
  })
})
