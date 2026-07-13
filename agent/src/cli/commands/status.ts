import { Command } from 'commander'
import { FileWorkflowRepository } from '../../infrastructure/index.js'

/**
 * 状态查询直接扫描任务文档，不依赖派生索引。
 * 输出按任务编号排序，与实际顺序执行规则完全一致。
 */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('查看任务状态')
    .action(() => {
      const tasks = new FileWorkflowRepository(process.cwd()).listTasks()
      if (tasks.length === 0) {
        console.log('尚未生成任务。')
        return
      }
      for (const task of tasks) {
        console.log(`${task.metadata.id.padEnd(10)} ${task.metadata.status.padEnd(10)} ${task.metadata.title}`)
      }
    })
}
