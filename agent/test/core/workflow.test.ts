import { describe, expect, it } from 'vitest'
import { formatTaskId, TaskExecutionReportSchema } from '../../src/core/workflow.js'

const BASE_REPORT = {
  summary: '执行结果',
  progress: '后续任务需要知道的事实',
  changedFiles: [],
  verification: [],
}

describe('TaskExecutionReportSchema', () => {
  /**
   * 报告状态和阻塞原因共同决定工作流状态，二者必须形成一致契约。
   * 这些用例防止 Claude 的矛盾自报进入任务文档和进度历史。
   */
  it('完成报告不能携带阻塞原因', () => {
    const result = TaskExecutionReportSchema.safeParse({
      ...BASE_REPORT,
      status: 'completed',
      blocker: '仍需用户确认',
    })

    expect(result.success).toBe(false)
  })

  it('阻塞报告必须明确阻塞原因', () => {
    const result = TaskExecutionReportSchema.safeParse({
      ...BASE_REPORT,
      status: 'blocked',
      blocker: '   ',
    })

    expect(result.success).toBe(false)
  })
})

describe('formatTaskId', () => {
  it('统一生成三位顺序任务 ID 并拒绝越界序号', () => {
    expect(formatTaskId(1)).toBe('TASK-001')
    expect(formatTaskId(999)).toBe('TASK-999')
    expect(() => formatTaskId(1000)).toThrow('任务序号必须是 1 到 999 的整数')
  })
})
