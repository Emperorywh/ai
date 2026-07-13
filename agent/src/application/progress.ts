import type { TaskExecutionReport, TaskRecord } from '../core/workflow.js'

export interface ProgressEntry {
  readonly taskId: string
  readonly title: string
  readonly status: 'completed' | 'blocked'
  readonly summary: string
  readonly progress: string
  readonly changedFiles: readonly string[]
  readonly verification: readonly string[]
  readonly blocker: string
  readonly recordedAt: string
}

const HISTORY_HEADING = '## 执行历史'

/**
 * 进度文档是可重建的当前视图加不可丢失的执行历史。
 * 当前任务状态来自任务文档，历史则从旧进度文档中提取并追加。
 */
export function renderProgress(
  tasks: readonly TaskRecord[],
  entry: ProgressEntry,
  previousProgress: string,
): string {
  const completed = tasks.filter((task) => task.metadata.status === 'completed').length
  const oldHistory = extractHistory(previousProgress)
  const taskLines = tasks.map((task) => {
    const mark = task.metadata.status === 'completed' ? 'x' : ' '
    return `- [${mark}] ${task.metadata.id} ${task.metadata.title}（${task.metadata.status}）`
  })

  return [
    '# PROGRESS — 项目进度',
    '',
    '> 本文档由工作流在每次任务执行后统一更新，供后续独立 Claude Code 会话恢复上下文。',
    '',
    '## 当前状态',
    '',
    `已完成 ${completed}/${tasks.length} 个任务。`,
    '',
    ...taskLines,
    '',
    '## 最近一次执行',
    '',
    renderEntry(entry),
    '',
    HISTORY_HEADING,
    '',
    renderEntry(entry),
    oldHistory ? `\n${oldHistory}` : '',
    '',
  ].join('\n')
}

/**
 * 将 Claude 的结构化报告转换成稳定的进度条目。
 * 时间由调用方注入，测试不依赖系统时钟。
 */
export function toProgressEntry(
  task: TaskRecord,
  report: TaskExecutionReport,
  recordedAt: string,
): ProgressEntry {
  return {
    taskId: task.metadata.id,
    title: task.metadata.title,
    status: report.status,
    summary: report.summary,
    progress: report.progress,
    changedFiles: report.changedFiles,
    verification: report.verification,
    blocker: report.blocker,
    recordedAt,
  }
}

function extractHistory(progress: string): string {
  const index = progress.indexOf(HISTORY_HEADING)
  if (index < 0) return ''
  return progress.slice(index + HISTORY_HEADING.length).trim()
}

function renderEntry(entry: ProgressEntry): string {
  const lines = [
    `### ${entry.taskId} ${entry.title}`,
    '',
    `- 状态：${entry.status}`,
    `- 时间：${entry.recordedAt}`,
    `- 结果：${entry.summary}`,
    `- 对后续任务有用的信息：${entry.progress}`,
  ]
  lines.push(`- 变更文件：${entry.changedFiles.join('、') || '无'}`)
  lines.push(`- 验证：${entry.verification.join('；') || '未执行'}`)
  if (entry.blocker) lines.push(`- 阻塞原因：${entry.blocker}`)
  return lines.join('\n')
}
