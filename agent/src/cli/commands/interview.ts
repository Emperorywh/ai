import { createInterface } from 'node:readline/promises'
import { Command } from 'commander'
import { GenerateSpecificationUseCase } from '../../application/index.js'
import { createRuntime } from '../composition.js'
import { ReadlineInterviewIO } from '../readline-interview-io.js'

/**
 * 访谈命令负责终端问答，深度和完成判断交给 Claude。
 * 用户可输入或粘贴多行自然语言、代码和列表，显式命令统一提交本轮回答。
 * 聚合后的完整答案会显式进入下一轮访谈上下文，不依赖终端隐藏状态。
 */
export function registerInterviewCommand(program: Command): void {
  program
    .command('interview')
    .description('通过深度访谈生成 docs/SPEC.md')
    .argument('<requirement...>', '你的初始需求')
    .action(async (requirementParts: string[]) => {
      const runtime = createRuntime(process.cwd())
      const readline = createInterface({ input: process.stdin, output: process.stdout })
      const interviewIO = new ReadlineInterviewIO(readline)
      const useCase = new GenerateSpecificationUseCase(runtime.agent, runtime.repository, interviewIO)

      try {
        console.log('正在分析初始需求并开始访谈……')
        await useCase.execute(requirementParts.join(' '))
        console.log('\n规格已生成：docs/SPEC.md')
      } finally {
        readline.close()
      }
    })
}
