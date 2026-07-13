import { Command } from 'commander'
import { FileWorkflowRepository } from '../../infrastructure/index.js'

/**
 * 初始化创建工作流事实文档和两份可移植的 AI 提示词。
 * 已存在文件保持不变，因此可安全地在已有项目根目录中执行。
 */
export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('初始化任务工作流文档与 AI 提示词')
    .argument('[targetDir]', '目标项目目录，默认当前目录')
    .action((targetDir: string | undefined) => {
      const repository = new FileWorkflowRepository(targetDir ?? process.cwd())
      const result = repository.initialize()
      console.log(`初始化完成：${repository.projectRoot}`)
      console.log(`新建 ${result.created.length} 个文件，跳过 ${result.skipped.length} 个已有文件。`)
      console.log('规格提示词：prompts/generate-specification.md')
      console.log('任务提示词：prompts/generate-tasks.md')
    })
}
