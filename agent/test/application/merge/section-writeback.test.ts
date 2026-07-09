import { describe, expect, it } from 'vitest'
import { GlobalDocRepository } from '../../../src/infrastructure/index.js'
import {
  writebackGlobalDocs,
  type IdAllocator,
  type WritebackRequest,
} from '../../../src/application/index.js'
import type { GlobalDocName, GlobalDocRepositoryPort } from '../../../src/application/ports.js'
import type { Decision, Issue, TaskId } from '../../../src/core/index.js'

/* ============================================================ *
 * 夹具:内存全局文档 Port + 纯函数式 id 分配器
 * ============================================================ */

/**
 * 内存版 GlobalDocRepositoryPort:文件 I/O 走内存 store,正文变换委托真实 GlobalDocRepository
 * (复用 TASK-012 的 section 合并 / 条目去重原语,不重复实现)。writes 记录被写回的文档名,
 * 供断言「无请求不写盘」。
 */
function memGlobalRepo(initial: Record<GlobalDocName, string>): GlobalDocRepositoryPort & {
  writes: Set<GlobalDocName>
} {
  const store: Record<GlobalDocName, string> = { ...initial }
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

/**
 * 纯函数式 id 分配器:从 usedIds 中同前缀最大编号 +1(DEC-001/ISS-001 三位补零)。
 * 完全由 usedIds 推断,不持有计数器状态,便于断言「分配点单一、不撞既有」。
 */
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

/** 提议态决策(id 留空,字段集满足 DecisionSchema,便于 readDecisions 读回)。 */
function proposedDecision(over: Partial<Decision> = {}): Decision {
  return {
    id: '',
    title: '某决策',
    status: 'proposed',
    scope: 'application',
    created_from_task: 'TASK-020',
    decision: '采用 X 方案',
    rationale: '理由',
    consequences: '后果',
    ...over,
  }
}

/** 提议态问题(id 留空,字段集满足 IssueSchema)。 */
function proposedIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: '',
    title: '某问题',
    status: 'open',
    severity: 'medium',
    scope: 'application',
    created_from_task: 'TASK-020',
    owner: '',
    recommended_action: '建议动作',
    ...over,
  }
}

/** 构造单任务回写请求(progress / decisions / issues 任选)。 */
function req(
  taskId: TaskId,
  updates: { progress?: WritebackRequest['updates']['progress']; decisions?: Decision[]; issues?: Issue[] },
): WritebackRequest {
  return {
    task_id: taskId,
    updates: {
      progress: updates.progress ?? [],
      decisions: updates.decisions ?? [],
      issues: updates.issues ?? [],
    },
  }
}

/* seed 文档:含 frontmatter + 初始正文,decision/issue 的 fenced yaml block 满足 Schema。 */
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

const DECISIONS_SEED = [
  '---',
  'doc: DECISIONS',
  'status: active',
  '---',
  '',
  '# DECISIONS',
  '',
  '---',
  '',
  '## DEC-001 决策一',
  '',
  '```yaml',
  'id: DEC-001',
  'title: "决策一"',
  'status: accepted',
  'scope: core',
  'created_from_task: TASK-001',
  'decision: "已有决策"',
  'rationale: "已有理由"',
  'consequences: "已有后果"',
  '```',
  '',
  '---',
  '',
  '## DEC-002 决策二',
  '',
  '```yaml',
  'id: DEC-002',
  'title: "决策二"',
  'status: accepted',
  'scope: core',
  'created_from_task: TASK-002',
  'decision: "已有决策二"',
  'rationale: "已有理由二"',
  'consequences: "已有后果二"',
  '```',
  '',
].join('\n')

const ISSUES_SEED = [
  '---',
  'doc: ISSUES',
  'status: active',
  '---',
  '',
  '# ISSUES',
  '',
  '---',
  '',
  '## ISS-001 问题一',
  '',
  '```yaml',
  'id: ISS-001',
  'title: "问题一"',
  'status: open',
  'severity: low',
  'scope: core',
  'created_from_task: TASK-001',
  'owner: ""',
  'recommended_action: "已有建议"',
  '```',
  '',
].join('\n')

function freshRepo(): ReturnType<typeof memGlobalRepo> {
  return memGlobalRepo({
    progress: PROGRESS_SEED,
    decisions: DECISIONS_SEED,
    issues: ISSUES_SEED,
  })
}

/* ============================================================ *
 * PROGRESS section 合并
 * ============================================================ */

describe('writebackGlobalDocs — PROGRESS section 合并', () => {
  it('append 不同 section 互不干扰,同 section 按拓扑序叠加', () => {
    const repo = memGlobalRepo({ progress: PROGRESS_SEED, decisions: DECISIONS_SEED, issues: ISSUES_SEED })
    const outcome = writebackGlobalDocs(
      repo,
      [
        req('TASK-001', {
          progress: [
            { section: '当前完成到哪个任务', mode: 'append', content: 'TASK-001 内容' },
            { section: '当前系统可用能力', mode: 'append', content: '能力 A' },
          ],
        }),
        req('TASK-002', {
          progress: [{ section: '当前完成到哪个任务', mode: 'append', content: 'TASK-002 内容' }],
        }),
      ],
      { idAllocator: sequentialAllocator() },
    )

    // 不同 section 各自更新,互不干扰。
    expect(outcome.docs.progress).toContain('能力 A')
    // 同 section 两条 append 都保留(按拓扑序叠加)。
    expect(outcome.docs.progress).toContain('TASK-001 内容')
    expect(outcome.docs.progress).toContain('TASK-002 内容')
    // 无冲突。
    expect(outcome.progress_conflicts).toEqual([])
    // 已写盘。
    expect(repo.writes.has('progress')).toBe(true)
  })

  it('replace 单条正常整段替换(标题保留)', () => {
    const repo = memGlobalRepo({ progress: PROGRESS_SEED, decisions: DECISIONS_SEED, issues: ISSUES_SEED })
    const outcome = writebackGlobalDocs(
      repo,
      [req('TASK-001', { progress: [{ section: '当前完成到哪个任务', mode: 'replace', content: '替换后内容' }] })],
      { idAllocator: sequentialAllocator() },
    )
    expect(outcome.docs.progress).toContain('替换后内容')
    // 原始内容被整段替换掉。
    expect(outcome.docs.progress).not.toContain('初始状态。')
    expect(outcome.progress_conflicts).toEqual([])
  })

  it('同 section 多 replace:后写者覆盖、先写者入冲突清单(§3.2)', () => {
    const repo = memGlobalRepo({ progress: PROGRESS_SEED, decisions: DECISIONS_SEED, issues: ISSUES_SEED })
    const outcome = writebackGlobalDocs(
      repo,
      [
        req('TASK-001', { progress: [{ section: '当前完成到哪个任务', mode: 'replace', content: '先写者 A' }] }),
        req('TASK-002', { progress: [{ section: '当前完成到哪个任务', mode: 'replace', content: '后写者 B' }] }),
      ],
      { idAllocator: sequentialAllocator() },
    )

    // 后写者 B 生效,先写者 A 被覆盖。
    expect(outcome.docs.progress).toContain('后写者 B')
    expect(outcome.docs.progress).not.toContain('先写者 A')
    // 先写者入冲突清单。
    expect(outcome.progress_conflicts).toEqual([
      {
        section: '当前完成到哪个任务',
        task_id: 'TASK-001',
        content: '先写者 A',
        superseded_by: 'TASK-002',
      },
    ])
  })

  it('三条 replace 同 section:最后一条生效,前两条入冲突清单且 superseded_by 指向最后一条', () => {
    const repo = memGlobalRepo({ progress: PROGRESS_SEED, decisions: DECISIONS_SEED, issues: ISSUES_SEED })
    const outcome = writebackGlobalDocs(
      repo,
      [
        req('TASK-001', { progress: [{ section: '当前完成到哪个任务', mode: 'replace', content: '第一' }] }),
        req('TASK-002', { progress: [{ section: '当前完成到哪个任务', mode: 'replace', content: '第二' }] }),
        req('TASK-003', { progress: [{ section: '当前完成到哪个任务', mode: 'replace', content: '第三' }] }),
      ],
      { idAllocator: sequentialAllocator() },
    )

    expect(outcome.docs.progress).toContain('第三')
    expect(outcome.docs.progress).not.toContain('第一')
    expect(outcome.docs.progress).not.toContain('第二')
    expect(outcome.progress_conflicts).toEqual([
      { section: '当前完成到哪个任务', task_id: 'TASK-001', content: '第一', superseded_by: 'TASK-003' },
      { section: '当前完成到哪个任务', task_id: 'TASK-002', content: '第二', superseded_by: 'TASK-003' },
    ])
  })

  it('replace 在 append 之后(拓扑序):replace 覆盖此前 append,不算冲突', () => {
    const repo = memGlobalRepo({ progress: PROGRESS_SEED, decisions: DECISIONS_SEED, issues: ISSUES_SEED })
    const outcome = writebackGlobalDocs(
      repo,
      [
        req('TASK-001', { progress: [{ section: '当前完成到哪个任务', mode: 'append', content: 'append 内容' }] }),
        req('TASK-002', { progress: [{ section: '当前完成到哪个任务', mode: 'replace', content: 'replace 内容' }] }),
      ],
      { idAllocator: sequentialAllocator() },
    )
    // replace 覆盖了此前 append(后写者覆盖),append 不算冲突。
    expect(outcome.docs.progress).toContain('replace 内容')
    expect(outcome.docs.progress).not.toContain('append 内容')
    expect(outcome.progress_conflicts).toEqual([])
  })

  it('append 在 replace 之后(拓扑序):replace 生效后 append 追加其上,不算冲突', () => {
    const repo = memGlobalRepo({ progress: PROGRESS_SEED, decisions: DECISIONS_SEED, issues: ISSUES_SEED })
    const outcome = writebackGlobalDocs(
      repo,
      [
        req('TASK-001', { progress: [{ section: '当前完成到哪个任务', mode: 'replace', content: 'replace 内容' }] }),
        req('TASK-002', { progress: [{ section: '当前完成到哪个任务', mode: 'append', content: 'append 内容' }] }),
      ],
      { idAllocator: sequentialAllocator() },
    )
    expect(outcome.docs.progress).toContain('replace 内容')
    expect(outcome.docs.progress).toContain('append 内容')
    expect(outcome.progress_conflicts).toEqual([])
  })
})

/* ============================================================ *
 * DECISIONS / ISSUES id 分配与去重
 * ============================================================ */

describe('writebackGlobalDocs — DECISIONS / ISSUES id 分配去重', () => {
  it('decisions 提议态 id 经 allocator 分配后追加,assigned 记录来源', () => {
    const repo = freshRepo()
    const outcome = writebackGlobalDocs(
      repo,
      [req('TASK-020', { decisions: [proposedDecision({ title: '新决策' })] })],
      { idAllocator: sequentialAllocator() },
    )
    // 从既有最大(DEC-002)+1 → DEC-003。
    expect(outcome.assigned_decision_ids).toEqual([{ task_id: 'TASK-020', id: 'DEC-003' }])
    // 文档已追加且可被 readDecisions 读回(合法 Schema)。
    expect(outcome.docs.decisions).toContain('DEC-003')
    expect(repo.readDecisions(outcome.docs.decisions).map((d) => d.id)).toContain('DEC-003')
    expect(repo.writes.has('decisions')).toBe(true)
  })

  it('decisions id 从既有最大编号 +1,不撞既有(去重基线含既有)', () => {
    const repo = freshRepo()
    const outcome = writebackGlobalDocs(
      repo,
      [req('TASK-020', { decisions: [proposedDecision(), proposedDecision()] })],
      { idAllocator: sequentialAllocator() },
    )
    // 既有 DEC-001/DEC-002,新分配 DEC-003、DEC-004,批次内唯一。
    expect(outcome.assigned_decision_ids.map((a) => a.id)).toEqual(['DEC-003', 'DEC-004'])
  })

  it('decisions 带非空 id 沿用其 id(appendDecision 去重:命中既有则替换)', () => {
    const repo = freshRepo()
    const outcome = writebackGlobalDocs(
      repo,
      [
        req('TASK-020', {
          decisions: [proposedDecision({ id: 'DEC-099', title: '自定义 id 决策' })],
        }),
      ],
      { idAllocator: sequentialAllocator() },
    )
    expect(outcome.assigned_decision_ids).toEqual([{ task_id: 'TASK-020', id: 'DEC-099' }])
    expect(outcome.docs.decisions).toContain('DEC-099')
  })

  it('issues 提议态 id 经 allocator 分配后追加', () => {
    const repo = freshRepo()
    const outcome = writebackGlobalDocs(
      repo,
      [req('TASK-020', { issues: [proposedIssue({ title: '新问题' })] })],
      { idAllocator: sequentialAllocator() },
    )
    // 既有 ISS-001,新分配 ISS-002。
    expect(outcome.assigned_issue_ids).toEqual([{ task_id: 'TASK-020', id: 'ISS-002' }])
    expect(outcome.docs.issues).toContain('ISS-002')
    expect(repo.readIssues(outcome.docs.issues).map((i) => i.id)).toContain('ISS-002')
    expect(repo.writes.has('issues')).toBe(true)
  })

  it('decisions 与 issues 各自独立编号(DEC 与 ISS 序列不混淆)', () => {
    const repo = freshRepo()
    const outcome = writebackGlobalDocs(
      repo,
      [
        req('TASK-020', {
          decisions: [proposedDecision()],
          issues: [proposedIssue()],
        }),
      ],
      { idAllocator: sequentialAllocator() },
    )
    expect(outcome.assigned_decision_ids.map((a) => a.id)).toEqual(['DEC-003'])
    expect(outcome.assigned_issue_ids.map((a) => a.id)).toEqual(['ISS-002'])
  })
})

/* ============================================================ *
 * 综合:空请求、混合回写
 * ============================================================ */

describe('writebackGlobalDocs — 综合行为', () => {
  it('空请求:不写盘任何文档,docs 保留读取原文,无冲突无分配', () => {
    const repo = freshRepo()
    const outcome = writebackGlobalDocs(repo, [], { idAllocator: sequentialAllocator() })

    expect(outcome.progress_conflicts).toEqual([])
    expect(outcome.assigned_decision_ids).toEqual([])
    expect(outcome.assigned_issue_ids).toEqual([])
    // 三份文档均未写盘(无变更)。
    expect(repo.writes.size).toBe(0)
    // docs 保留读取的原内容。
    expect(outcome.docs.progress).toBe(PROGRESS_SEED)
    expect(outcome.docs.decisions).toBe(DECISIONS_SEED)
    expect(outcome.docs.issues).toBe(ISSUES_SEED)
  })

  it('progress + decisions + issues 混合回写互不干扰', () => {
    const repo = freshRepo()
    const outcome = writebackGlobalDocs(
      repo,
      [
        req('TASK-020', {
          progress: [{ section: '当前完成到哪个任务', mode: 'replace', content: 'TASK-020 已完成' }],
          decisions: [proposedDecision({ title: 'section 回写决策' })],
          issues: [proposedIssue({ title: 'section 回写问题' })],
        }),
      ],
      { idAllocator: sequentialAllocator() },
    )

    // 三份文档各自正确回写。
    expect(outcome.docs.progress).toContain('TASK-020 已完成')
    expect(outcome.docs.decisions).toContain('DEC-003')
    expect(outcome.docs.issues).toContain('ISS-002')
    expect(repo.writes.has('progress')).toBe(true)
    expect(repo.writes.has('decisions')).toBe(true)
    expect(repo.writes.has('issues')).toBe(true)
    expect(outcome.progress_conflicts).toEqual([])
  })

  it('仅 progress 有请求时只写 PROGRESS,不触碰 decisions/issues', () => {
    const repo = freshRepo()
    const outcome = writebackGlobalDocs(
      repo,
      [req('TASK-020', { progress: [{ section: '当前完成到哪个任务', mode: 'append', content: '仅 progress' }] })],
      { idAllocator: sequentialAllocator() },
    )
    expect(repo.writes.has('progress')).toBe(true)
    expect(repo.writes.has('decisions')).toBe(false)
    expect(repo.writes.has('issues')).toBe(false)
    // decisions/issues 保留原文。
    expect(outcome.docs.decisions).toBe(DECISIONS_SEED)
    expect(outcome.docs.issues).toBe(ISSUES_SEED)
  })
})
