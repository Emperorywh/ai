import { describe, expect, it } from 'vitest'
import { GlobalDocRepository, parseDocument, serializeDocument } from '../../../src/infrastructure/index.js'
import type { Decision, Issue, ProgressUpdateRequest } from '../../../src/core/index.js'

/* ============================================================ *
 * 夹具：frontmatter（方法原样保留 frontmatter，只改正文，内容不参与校验）
 * ============================================================ */

const PROGRESS_FM = { doc: 'PROGRESS', status: 'active' }
const DECISIONS_FM = { doc: 'DECISIONS', status: 'active' }
const ISSUES_FM = { doc: 'ISSUES', status: 'active' }

/* ============================================================ *
 * 夹具：PROGRESS 正文（镜像 Readme §6.5 多 section 结构）
 * ============================================================ */

const PROGRESS_BODY = `# PROGRESS — 当前项目状态

> 本文件只保留当前有效状态。

## 当前完成到哪个任务

- TASK-001（脚手架）已完成。

## 当前系统可用能力

- Core 领域原语齐备。

## 建议下一个任务

- TASK-012：全局文档仓储。
`

const PROGRESS_DOC = serializeDocument(PROGRESS_FM, PROGRESS_BODY)

/* ============================================================ *
 * 夹具：DECISIONS 正文（镜像 Readme §6.6 / 现有 DECISIONS.md：--- 分隔 + 标题 + fenced yaml + prose）
 * ============================================================ */

const DECISIONS_BODY = `# DECISIONS — 架构决策记录

> 本文件记录重要架构决策。

---

## DEC-001 既有决策甲

\`\`\`yaml
id: DEC-001
title: 既有决策甲
status: accepted
scope: core
created_from_task: TASK-002
decision: 选择方案 A
rationale: 方案 A 更简洁
consequences: 后续须复用
\`\`\`

提议自 TASK-002。

---

## DEC-002 既有决策乙

\`\`\`yaml
id: DEC-002
title: 既有决策乙
status: proposed
scope: cli
created_from_task: TASK-003
decision: 选择方案 B
rationale: 方案 B 更灵活
consequences: 后续须调整
\`\`\`

提议自 TASK-003。
`

const DECISIONS_DOC = serializeDocument(DECISIONS_FM, DECISIONS_BODY)

const DECISION_A: Decision = {
  id: 'DEC-001',
  title: '既有决策甲',
  status: 'accepted',
  scope: 'core',
  created_from_task: 'TASK-002',
  decision: '选择方案 A',
  rationale: '方案 A 更简洁',
  consequences: '后续须复用',
}

const NEW_DECISION: Decision = {
  id: 'DEC-099',
  title: '新决策',
  status: 'proposed',
  scope: 'infrastructure/fs',
  created_from_task: 'TASK-012',
  decision: '采用 fenced yaml block 表达条目',
  rationale: '与现有 DECISIONS.md 结构一致',
  consequences: 'readDecisions 须解析 fenced block',
}

const UPDATED_DECISION: Decision = {
  id: 'DEC-001',
  title: '既有决策甲（已更新）',
  status: 'superseded',
  scope: 'core',
  created_from_task: 'TASK-002',
  decision: '选择方案 A（已被取代）',
  rationale: '方案 A 更简洁',
  consequences: '已被 DEC-099 取代',
}

const PROPOSED_DECISION: Decision = {
  id: '',
  title: '提议态决策',
  status: 'proposed',
  scope: 'core',
  created_from_task: 'TASK-012',
  decision: '某提议',
  rationale: '某理由',
  consequences: '某后果',
}

/* ============================================================ *
 * 夹具：ISSUES 正文（镜像 Readme §6.7 / 现有 ISSUES.md）
 * ============================================================ */

const ISSUES_BODY = `# ISSUES — 未解决问题记录

> 本文件记录未解决问题。

---

## ISS-001 既有问题甲

\`\`\`yaml
id: ISS-001
title: 既有问题甲
status: open
severity: medium
scope: core
created_from_task: TASK-002
owner: ""
recommended_action: 由 Orchestrator 确认后回写
\`\`\`

提议自 TASK-002。
`

const ISSUES_DOC = serializeDocument(ISSUES_FM, ISSUES_BODY)

const ISSUE_A: Issue = {
  id: 'ISS-001',
  title: '既有问题甲',
  status: 'open',
  severity: 'medium',
  scope: 'core',
  created_from_task: 'TASK-002',
  owner: '',
  recommended_action: '由 Orchestrator 确认后回写',
}

const NEW_ISSUE: Issue = {
  id: 'ISS-099',
  title: '新问题',
  status: 'open',
  severity: 'low',
  scope: 'infrastructure/fs',
  created_from_task: 'TASK-012',
  owner: '',
  recommended_action: '评估 fenced block 解析边界',
}

/* ============================================================ *
 * 辅助：解析结果的正文 / frontmatter
 * ============================================================ */

/** 取合并后文档的正文（剥离 frontmatter）。 */
function bodyOf(doc: string): string {
  return parseDocument(doc).body
}

/** 取合并后文档的 frontmatter。 */
function fmOf(doc: string): unknown {
  return parseDocument(doc).frontmatter
}

const repo = new GlobalDocRepository()

/* ============================================================ *
 * applyProgressUpdate — replace
 * ============================================================ */

describe('GlobalDocRepository — applyProgressUpdate replace', () => {
  const replace: ProgressUpdateRequest = {
    section: '建议下一个任务',
    mode: 'replace',
    content: '- TASK-013：SQLite 索引仓储。',
  }

  it('整段替换目标 section 内容，旧内容消失', () => {
    const result = bodyOf(repo.applyProgressUpdate(PROGRESS_DOC, replace))
    expect(result).toContain('- TASK-013：SQLite 索引仓储。')
    expect(result).not.toContain('TASK-012：全局文档仓储')
  })

  it('不误改其他 section（当前完成到哪个任务保留）', () => {
    const result = bodyOf(repo.applyProgressUpdate(PROGRESS_DOC, replace))
    expect(result).toContain('- TASK-001（脚手架）已完成。')
    expect(result).toContain('## 当前完成到哪个任务')
  })

  it('frontmatter 原样保留', () => {
    const result = repo.applyProgressUpdate(PROGRESS_DOC, replace)
    expect(fmOf(result)).toEqual(PROGRESS_FM)
  })

  it('多行 content 整体写入', () => {
    const multi: ProgressUpdateRequest = {
      section: '建议下一个任务',
      mode: 'replace',
      content: '- TASK-013：A。\n- TASK-014：B。',
    }
    const result = bodyOf(repo.applyProgressUpdate(PROGRESS_DOC, multi))
    expect(result).toContain('- TASK-013：A。')
    expect(result).toContain('- TASK-014：B。')
  })
})

/* ============================================================ *
 * applyProgressUpdate — append
 * ============================================================ */

describe('GlobalDocRepository — applyProgressUpdate append', () => {
  const append: ProgressUpdateRequest = {
    section: '当前完成到哪个任务',
    mode: 'append',
    content: '- TASK-002（Core 枚举）已完成。',
  }

  it('拼接到目标 section 末尾，既有内容保留', () => {
    const result = bodyOf(repo.applyProgressUpdate(PROGRESS_DOC, append))
    expect(result).toContain('- TASK-001（脚手架）已完成。')
    expect(result).toContain('- TASK-002（Core 枚举）已完成。')
  })

  it('追加内容落在目标 section 内、下一个 section 之前', () => {
    const result = bodyOf(repo.applyProgressUpdate(PROGRESS_DOC, append))
    const appendedIdx = result.indexOf('- TASK-002（Core 枚举）已完成。')
    const nextSectionIdx = result.indexOf('## 当前系统可用能力')
    expect(appendedIdx).toBeLessThan(nextSectionIdx)
    expect(appendedIdx).toBeGreaterThan(result.indexOf('## 当前完成到哪个任务'))
  })
})

/* ============================================================ *
 * applyProgressUpdate — 缺失 section 视为新建（§8）
 * ============================================================ */

describe('GlobalDocRepository — applyProgressUpdate 缺失 section', () => {
  it('replace 不存在 section 时在文末新建', () => {
    const update: ProgressUpdateRequest = {
      section: '当前架构状态',
      mode: 'replace',
      content: '- 分层目录已建立。',
    }
    const result = bodyOf(repo.applyProgressUpdate(PROGRESS_DOC, update))
    expect(result).toContain('## 当前架构状态')
    expect(result).toContain('- 分层目录已建立。')
    // 既有 section 不受影响
    expect(result).toContain('## 建议下一个任务')
  })

  it('append 不存在 section 时同样在文末新建', () => {
    const update: ProgressUpdateRequest = {
      section: '当前未解决问题摘要',
      mode: 'append',
      content: '- 无新 issue。',
    }
    const result = bodyOf(repo.applyProgressUpdate(PROGRESS_DOC, update))
    expect(result).toContain('## 当前未解决问题摘要')
    expect(result).toContain('- 无新 issue。')
  })
})

/* ============================================================ *
 * applyProgressUpdate — section 匹配健壮性（§12）
 * ============================================================ */

describe('GlobalDocRepository — section 匹配健壮性', () => {
  it('section 名称前后空白被 trim 后匹配', () => {
    const update: ProgressUpdateRequest = {
      section: '  建议下一个任务  ',
      mode: 'replace',
      content: '- 新内容。',
    }
    const result = bodyOf(repo.applyProgressUpdate(PROGRESS_DOC, update))
    expect(result).toContain('- 新内容。')
    // 不应误建一个带空白的 section 标题
    expect(result).not.toContain('##   建议下一个任务  ')
  })

  it('### 子节属于其父 ## section：替换父节时子节一并替换，不误并入相邻 section', () => {
    const body = `## 父节

- 父内容

### 父节的子节

子节内容

## 相邻节

- 相邻内容
`
    const doc = serializeDocument(PROGRESS_FM, body)
    const update: ProgressUpdateRequest = {
      section: '父节',
      mode: 'replace',
      content: '- 新父内容。',
    }
    const result = bodyOf(repo.applyProgressUpdate(doc, update))
    expect(result).toContain('- 新父内容。')
    expect(result).toContain('## 相邻节')
    expect(result).toContain('- 相邻内容')
    // 父节内的子节随父节一并被替换掉
    expect(result).not.toContain('子节内容')
    expect(result).not.toContain('### 父节的子节')
  })

  it('append 到含子节的父节时，内容落在子节之后、相邻节之前', () => {
    const body = `## 父节

- 父内容

### 父节的子节

子节内容

## 相邻节
`
    const doc = serializeDocument(PROGRESS_FM, body)
    const update: ProgressUpdateRequest = {
      section: '父节',
      mode: 'append',
      content: '- 追加到父节。',
    }
    const result = bodyOf(repo.applyProgressUpdate(doc, update))
    const appendedIdx = result.indexOf('- 追加到父节。')
    expect(appendedIdx).toBeGreaterThan(result.indexOf('子节内容'))
    expect(appendedIdx).toBeLessThan(result.indexOf('## 相邻节'))
  })
})

/* ============================================================ *
 * appendDecision
 * ============================================================ */

describe('GlobalDocRepository — appendDecision', () => {
  it('新 id 在文末追加新条目（--- 分隔 + 标题 + fenced yaml）', () => {
    const result = bodyOf(repo.appendDecision(DECISIONS_DOC, NEW_DECISION))
    expect(result).toContain('## DEC-099 新决策')
    expect(result).toContain('id: DEC-099')
    // 既有条目保留
    expect(result).toContain('## DEC-001 既有决策甲')
    expect(result).toContain('## DEC-002 既有决策乙')
  })

  it('同 id 再追加 = 更新：替换标题与 yaml block，保留其后人工 prose', () => {
    const result = bodyOf(repo.appendDecision(DECISIONS_DOC, UPDATED_DECISION))
    expect(result).toContain('## DEC-001 既有决策甲（已更新）')
    expect(result).toContain('status: superseded')
    // 旧标题 / 旧 status 消失
    expect(result).not.toContain('## DEC-001 既有决策甲\n')
    expect(result).not.toContain('status: accepted')
    // yaml block 之后的人工 prose 保留
    expect(result).toContain('提议自 TASK-002。')
  })

  it('空 id（提议态）不匹配任何既有项，走文末追加', () => {
    const result = bodyOf(repo.appendDecision(DECISIONS_DOC, PROPOSED_DECISION))
    expect(result).toContain('## 提议态决策')
    expect(result).toContain('decision: 某提议')
  })

  it('frontmatter 原样保留', () => {
    const result = repo.appendDecision(DECISIONS_DOC, NEW_DECISION)
    expect(fmOf(result)).toEqual(DECISIONS_FM)
  })

  it('round-trip：readDecisions(appendDecision(doc, d)) 含 d', () => {
    const result = repo.appendDecision(DECISIONS_DOC, NEW_DECISION)
    expect(repo.readDecisions(result)).toContainEqual(NEW_DECISION)
  })
})

/* ============================================================ *
 * appendIssue
 * ============================================================ */

describe('GlobalDocRepository — appendIssue', () => {
  it('新 id 在文末追加新条目', () => {
    const result = bodyOf(repo.appendIssue(ISSUES_DOC, NEW_ISSUE))
    expect(result).toContain('## ISS-099 新问题')
    expect(result).toContain('id: ISS-099')
    expect(result).toContain('## ISS-001 既有问题甲')
  })

  it('同 id 再追加 = 更新：替换 yaml block，保留 prose', () => {
    const updated: Issue = { ...ISSUE_A, status: 'resolved', title: '既有问题甲（已解决）' }
    const result = bodyOf(repo.appendIssue(ISSUES_DOC, updated))
    expect(result).toContain('## ISS-001 既有问题甲（已解决）')
    expect(result).toContain('status: resolved')
    expect(result).not.toContain('status: open')
    expect(result).toContain('提议自 TASK-002。')
  })

  it('round-trip：readIssues(appendIssue(doc, i)) 含 i', () => {
    const result = repo.appendIssue(ISSUES_DOC, NEW_ISSUE)
    expect(repo.readIssues(result)).toContainEqual(NEW_ISSUE)
  })
})

/* ============================================================ *
 * readDecisions / readIssues
 * ============================================================ */

describe('GlobalDocRepository — readDecisions', () => {
  it('解析全部 decision 条目（文档序）', () => {
    expect(repo.readDecisions(DECISIONS_DOC)).toEqual([
      {
        id: 'DEC-001',
        title: '既有决策甲',
        status: 'accepted',
        scope: 'core',
        created_from_task: 'TASK-002',
        decision: '选择方案 A',
        rationale: '方案 A 更简洁',
        consequences: '后续须复用',
      },
      {
        id: 'DEC-002',
        title: '既有决策乙',
        status: 'proposed',
        scope: 'cli',
        created_from_task: 'TASK-003',
        decision: '选择方案 B',
        rationale: '方案 B 更灵活',
        consequences: '后续须调整',
      },
    ])
  })

  it('无 decision 条目的文档返回空数组', () => {
    expect(repo.readDecisions(PROGRESS_DOC)).toEqual([])
  })

  it('跳过不能通过 DecisionSchema 校验的 yaml block（非决策 / 字段缺失）', () => {
    const body = `# DECISIONS

## DEC-001 合法决策

\`\`\`yaml
id: DEC-001
title: 合法
status: accepted
scope: core
created_from_task: TASK-002
decision: x
rationale: y
consequences: z
\`\`\`

## 非决策的 yaml 块

\`\`\`yaml
command: npm test
layers: [type, domain]
\`\`\`

## 字段缺失的块

\`\`\`yaml
id: DEC-002
title: 缺字段
\`\`\`
`
    const doc = serializeDocument(DECISIONS_FM, body)
    expect(repo.readDecisions(doc)).toHaveLength(1)
    expect(repo.readDecisions(doc)[0]?.id).toBe('DEC-001')
  })

  it('不含 frontmatter 的纯正文亦可解析（frontmatter=null 时只读 body）', () => {
    expect(repo.readDecisions(DECISIONS_BODY)).toEqual([
      DECISION_A,
      {
        id: 'DEC-002',
        title: '既有决策乙',
        status: 'proposed',
        scope: 'cli',
        created_from_task: 'TASK-003',
        decision: '选择方案 B',
        rationale: '方案 B 更灵活',
        consequences: '后续须调整',
      },
    ])
  })
})

describe('GlobalDocRepository — readIssues', () => {
  it('解析 issue 条目', () => {
    expect(repo.readIssues(ISSUES_DOC)).toEqual([ISSUE_A])
  })

  it('readDecisions 不误收 issue 条目（Schema 字段集不同，天然区分）', () => {
    // ISSUES 文档的 yaml block 缺 decision/rationale/consequences，不能通过 DecisionSchema
    expect(repo.readDecisions(ISSUES_DOC)).toEqual([])
  })
})
