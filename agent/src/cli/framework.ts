import { Command, CommanderError } from 'commander'
import { registerInitCommand } from './commands/init.js'
import { registerInterviewCommand } from './commands/interview.js'
import { registerPlanCommand } from './commands/plan.js'
import { registerRunCommand } from './commands/run.js'
import { registerStatusCommand } from './commands/status.js'

/**
 * CLI 只暴露 MVP 五个动作，命令名称直接对应产品主流程。
 * 所有业务异常在这里统一转换为简洁的非零退出码。
 */
export function createProgram(): Command {
  const program = new Command()
  program
    .name('caw')
    .description('规格访谈驱动的 Claude Code 任务执行器')
    .version('0.1.0')
    .exitOverride((error: CommanderError) => {
      throw error
    })
  registerInitCommand(program)
  registerInterviewCommand(program)
  registerPlanCommand(program)
  registerRunCommand(program)
  registerStatusCommand(program)
  return program
}

/**
 * 测试和真实 bin 共用同一异步入口。
 * 空参数展示帮助，Commander 的帮助退出不被当作业务错误。
 */
export async function runCli(argv: readonly string[]): Promise<number> {
  const program = createProgram()
  try {
    if (argv.length === 0) {
      program.outputHelp()
      return 0
    }
    await program.parseAsync([...argv], { from: 'user' })
    return 0
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander 的 help/version 也通过异常退出，但退出码为 0。
      // 只打印真正的参数错误，避免帮助末尾出现内部的 “(outputHelp)” 文本。
      if (error.exitCode !== 0) {
        console.error(error.message)
      }
      return error.exitCode
    }
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}
