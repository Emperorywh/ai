import { Command } from 'commander'
import { ExecuteNextTaskUseCase, ExecuteWorkflowUseCase } from '../../application/index.js'
import { createRuntime } from '../composition.js'

/**
 * run 顺序执行所有未完成任务，每个任务都创建全新的 Claude Code 会话。
 * 当前任务 completed 后自动继续，blocked 或异常时停止整个顺序工作流。
 */
export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('使用独立会话顺序执行所有未完成任务')
    .action(async () => {
      const runtime = createRuntime(process.cwd(), (message) => console.log(message))
      const executeNextTask = new ExecuteNextTaskUseCase(runtime.agent, runtime.repository)
      const useCase = new ExecuteWorkflowUseCase(executeNextTask, ({ task, report }) => {
        console.log(`${task.metadata.id}：${report.status}`)
        console.log(report.summary)
        console.log('进度已更新：docs/PROGRESS.md')
      })
      console.log('正在顺序启动独立 Claude Code 任务会话……')
      const outcome = await useCase.execute()
      if (outcome.executions.length === 0) {
        console.log('所有任务均已完成。')
        return
      }
      if (outcome.status === 'blocked') {
        console.log('工作流因当前任务阻塞而停止。处理阻塞原因后可再次运行 caw run。')
        return
      }
      console.log(`全部任务执行完成，本次共完成 ${outcome.executions.length} 个任务。`)
    })
}
