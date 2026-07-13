import type { CodingAgentPort, InterviewIOPort, InterviewMessage, WorkflowRepositoryPort } from './ports.js'

const MAX_INTERVIEW_ROUNDS = 30

/**
 * 深度访谈用例只维护显式对话记录，不依赖 SDK 的隐藏 session。
 * 每轮模型都能看到完整访谈事实，最终规格落盘后才算用例完成。
 */
export class GenerateSpecificationUseCase {
  constructor(
    private readonly agent: CodingAgentPort,
    private readonly repository: WorkflowRepositoryPort,
    private readonly io: InterviewIOPort,
  ) {}

  async execute(initialRequirement: string): Promise<string> {
    const requirement = initialRequirement.trim()
    if (!requirement) throw new Error('初始需求不能为空')

    const transcript: InterviewMessage[] = []
    for (let round = 0; round < MAX_INTERVIEW_ROUNDS; round += 1) {
      const reply = await this.agent.interview(requirement, transcript)
      if (reply.status === 'complete') {
        const specification = reply.specification.trim()
        if (!specification) throw new Error('Claude 返回完成状态，但规格文档为空')
        this.repository.writeSpecification(specification)
        return specification
      }

      const question = reply.question.trim()
      if (!question) throw new Error('Claude 返回追问状态，但问题为空')
      const answer = (await this.io.ask(question)).trim()
      transcript.push({ role: 'assistant', content: question })
      transcript.push({
        role: 'user',
        content: answer || '我暂时没有更多信息，请基于已有内容继续判断。',
      })
    }

    throw new Error(`访谈已达到 ${MAX_INTERVIEW_ROUNDS} 轮，仍未形成完整规格`)
  }
}
