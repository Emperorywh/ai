import { Command } from 'commander'
import { ExecuteNextTaskUseCase } from '../../application/index.js'
import { createRuntime } from '../composition.js'

/**
 * 每次 run 只执行第一个未完成任务，并创建全新的 Claude Code 会话。
 * 完成或阻塞后，用例会统一更新任务状态和 docs/PROGRESS.md。
 */
export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('执行下一个未完成任务')
    .action(async () => {
      const runtime = createRuntime(process.cwd(), (message) => console.log(message))
      const useCase = new ExecuteNextTaskUseCase(runtime.agent, runtime.repository)
      console.log('正在启动独立 Claude Code 任务会话……')
      const outcome = await useCase.execute()
      if (!outcome.task || !outcome.report) {
        console.log('所有任务均已完成。')
        return
      }
      console.log(`${outcome.task.metadata.id}：${outcome.report.status}`)
      console.log(outcome.report.summary)
      console.log('进度已更新：docs/PROGRESS.md')
    })
}
