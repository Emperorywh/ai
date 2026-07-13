import type { InterviewIOPort } from '../application/index.js'
import { restorePastedNewlines } from './bracketed-paste-input.js'

export interface InterviewReadline {
  question(query: string): Promise<string>
}

export type InterviewOutput = (message: string) => void

/**
 * Readline 访谈适配器保持普通问答的单行提交语义。
 * 多行粘贴已由输入流转换为一个逻辑行，这里只负责还原换行并交给应用层。
 */
export class ReadlineInterviewIO implements InterviewIOPort {
  constructor(
    private readonly readline: InterviewReadline,
    private readonly writeLine: InterviewOutput = (message) => console.log(message),
  ) {}

  async ask(question: string): Promise<string> {
    this.writeLine(`\nClaude：${question}`)
    const answer = await this.readline.question('你：')
    return restorePastedNewlines(answer)
  }
}
