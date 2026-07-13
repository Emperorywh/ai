import { Command } from 'commander'
import { FileWorkflowRepository } from '../../infrastructure/index.js'

/**
 * 初始化只创建核心事实文档，不生成架构、决策、问题或数据库配置。
 * 已存在文件保持不变，因此可安全地在已有项目根目录中执行。
 */
export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('初始化最小工作流文档')
    .argument('[targetDir]', '目标项目目录，默认当前目录')
    .action((targetDir: string | undefined) => {
      const repository = new FileWorkflowRepository(targetDir ?? process.cwd())
      const result = repository.initialize()
      console.log(`初始化完成：${repository.projectRoot}`)
      console.log(`新建 ${result.created.length} 个文件，跳过 ${result.skipped.length} 个已有文件。`)
    })
}
