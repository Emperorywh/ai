import { describe, expect, it } from 'vitest'
import { serializeMarkdownDocument } from '../../src/infrastructure/markdown-document.js'
import { parseTaskDocument } from '../../src/infrastructure/task-document.js'

/**
 * 测试文档工厂只改变 Frontmatter 和正文变量，统一保持 Markdown 编码协议。
 * 各用例可以聚焦外部 AI 输出边界，而不复制完整任务模板。
 */
function createDocument(id: string, body?: string): string {
  return serializeMarkdownDocument(
    { id, title: '标准任务', status: 'pending' },
    body ?? '# TASK-001 — 标准任务\n\n## 需求\n\n实现目标能力。\n\n## 验收标准\n\n- 能力可以验收',
  )
}

describe('parseTaskDocument', () => {
  it('接受文件名、元数据和正文结构一致的标准任务', () => {
    const task = parseTaskDocument('TASK-001', createDocument('TASK-001'))

    expect(task.metadata.id).toBe('TASK-001')
    expect(task.document).toContain('能力可以验收')
  })

  it('拒绝文件名与 Frontmatter id 不一致的任务', () => {
    expect(() => parseTaskDocument('TASK-001', createDocument('TASK-002'))).toThrow(
      '任务文件名与 Frontmatter id 不一致',
    )
  })

  it('拒绝缺少验收列表项的任务正文', () => {
    const document = createDocument(
      'TASK-001',
      '# TASK-001 — 标准任务\n\n## 需求\n\n实现目标能力。\n\n## 验收标准\n\n尚未定义。',
    )

    expect(() => parseTaskDocument('TASK-001', document)).toThrow('任务至少需要一条验收标准')
  })
})
