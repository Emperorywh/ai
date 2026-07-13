import { Command } from 'commander'
import { GenerateTasksUseCase } from '../../application/index.js'
import { createRuntime } from '../composition.js'

/**
 * 规划命令从最终规格重新生成需求型任务。
 * 旧任务会被整体替换，避免新规格与旧任务混用形成隐式兼容状态。
 */
export function registerPlanCommand(program: Command): void {
  program
    .command('plan')
    .description('从 docs/SPEC.md 生成顺序执行的需求任务')
    .action(async () => {
      const runtime = createRuntime(process.cwd())
      const useCase = new GenerateTasksUseCase(runtime.agent, runtime.repository)
      console.log('正在根据规格拆分任务……')
      const tasks = await useCase.execute()
      console.log(`已生成 ${tasks.length} 个任务：docs/tasks/`)
    })
}
