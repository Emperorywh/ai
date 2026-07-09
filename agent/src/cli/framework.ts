import { Command, CommanderError } from 'commander'
import { registerInitCommand } from './commands/init.js'
import { registerStatusCommand } from './commands/status.js'
import { registerRebuildIndexCommand } from './commands/rebuild-index.js'

/**
 * CLI 框架层：命令入口、命令注册、退出码约定与错误输出格式。
 *
 * 设计（见 docs/tasks/TASK-023 §8 / Readme §3.1）：
 *  - CLI 只作交互入口，不拥有核心状态机与任务规则，仅编排命令。
 *  - 退出码：0 成功，非 0 失败。commander 自身的 --help / 用法错误经 exitOverride
 *    转成 CommanderError，其 exitCode 透传；命令业务错误统一为 GeneralError。
 *  - 错误输出统一走 stderr：commander 用法错误自带 error: 前缀，业务错误手动补前缀。
 */

/** CLI 退出码约定。 */
export enum CliExitCode {
  /** 成功（含 --help / --version 这类 commander 正常退出）。 */
  Success = 0,
  /** 命令业务执行错误（通用非零）。 */
  GeneralError = 1,
}

/** 业务错误输出的统一前缀（stderr），便于人 / 脚本识别 CLI 错误。 */
const ERROR_PREFIX = 'error:'

/**
 * 创建配置好的 commander program：
 *  - exitOverride 让 commander 把退出意图（--help / 用法错误）转成可捕获的
 *    CommanderError，而非直接 process.exit，使 runCli 能统一管控退出码、且测试可注入。
 *  - 不给 program 设默认 action：否则 commander 会把「未知命令」当作默认命令的参数吞掉
 *    而不报错；空 argv 的帮助展示由 runCli 显式处理，未知命令交回 commander 默认报错。
 *  - 注册全部子命令（init / status / rebuild-index；后续命令在各自 CLI 任务追加 registerXxxCommand）。
 */
export function createProgram(): Command {
  const program = new Command()
  program
    .name('caw')
    .description('文档协议驱动的 Coding Agent 长任务工作流 CLI')
    .exitOverride((err: CommanderError) => {
      throw err
    })
  registerInitCommand(program)
  registerStatusCommand(program)
  registerRebuildIndexCommand(program)
  return program
}

/**
 * CLI 主入口：解析 argv、执行命令，返回退出码（不自行 process.exit，以便测试复用）。
 * bin 入口（dist/cli/index.js）与单元测试共用本函数。
 *
 * @param argv 用户参数（已剥离 node / 脚本名，即 process.argv.slice(2)）。
 */
export async function runCli(argv: string[]): Promise<number> {
  const program = createProgram()
  try {
    // 空 argv 时输出帮助（commander 默认静默不输出），避免用户面对无反馈的空运行
    if (argv.length === 0) {
      program.outputHelp()
      return CliExitCode.Success
    }
    await program.parseAsync(argv, { from: 'user' })
    return CliExitCode.Success
  } catch (err) {
    // commander 的退出意图（--help / 用法错误）经 exitOverride 抛 CommanderError
    if (err instanceof CommanderError) {
      // help / version 内容已在抛出前写入 stdout，不重复输出；其余用法错误输出 message 到 stderr
      if (err.code !== 'commander.help' && err.code !== 'commander.version' && err.message) {
        console.error(err.message)
      }
      return err.exitCode
    }
    // 命令业务执行错误（如 scaffoldProject 抛错）
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${ERROR_PREFIX} ${message}`)
    return CliExitCode.GeneralError
  }
}
