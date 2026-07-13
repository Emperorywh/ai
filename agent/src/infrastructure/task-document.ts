import type { TaskRecord } from '../core/workflow.js'
import { TaskMetadataSchema } from '../core/workflow.js'
import { parseMarkdownDocument } from './markdown-document.js'

const REQUIREMENT_HEADING_PATTERN = /^## 需求[ \t]*\r?$/m
const ACCEPTANCE_HEADING_PATTERN = /^## 验收标准[ \t]*\r?$/m
const TASK_FILE_PATTERN = /^(TASK-\d{3})\.md$/

/**
 * 文件名解析集中维护任务文件协议，调用方不再重复正则表达式。
 * 返回 null 表示该文件不能作为标准任务进入工作流。
 */
export function parseTaskFileName(fileName: string): string | null {
  return TASK_FILE_PATTERN.exec(fileName)?.[1] ?? null
}

/**
 * 外部 AI 生成的任务文档在进入执行用例前统一完成协议校验。
 * 文件名、机器元数据和正文语义必须相互一致，避免错误输入被静默执行。
 */
export function parseTaskDocument(expectedTaskId: string, document: string): TaskRecord {
  const parsed = parseMarkdownDocument(document)
  const metadata = TaskMetadataSchema.parse(parsed.frontmatter)
  if (metadata.id !== expectedTaskId) {
    throw new Error(`任务文件名与 Frontmatter id 不一致：${expectedTaskId} / ${metadata.id}`)
  }
  validateTaskBody(expectedTaskId, parsed.body)
  return { metadata, document }
}

/**
 * 正文只验证跨 AI 工具必须遵守的最小结构，不解释具体需求内容。
 * 验收标准至少包含一个 Markdown 列表项，保证执行会话有明确完成依据。
 */
function validateTaskBody(taskId: string, body: string): void {
  const requirementHeading = REQUIREMENT_HEADING_PATTERN.exec(body)
  const acceptanceHeading = ACCEPTANCE_HEADING_PATTERN.exec(body)
  if (!requirementHeading || !acceptanceHeading || acceptanceHeading.index <= requirementHeading.index) {
    throw new Error(`任务正文结构不合法：${taskId} 必须依次包含“需求”和“验收标准”`)
  }

  const requirement = body
    .slice(requirementHeading.index + requirementHeading[0].length, acceptanceHeading.index)
    .trim()
  if (!requirement) throw new Error(`任务需求不能为空：${taskId}`)

  const acceptanceCriteria = body.slice(acceptanceHeading.index + acceptanceHeading[0].length)
  if (!/^[ \t]*[-*+][ \t]+\S+/m.test(acceptanceCriteria)) {
    throw new Error(`任务至少需要一条验收标准：${taskId}`)
  }
}
