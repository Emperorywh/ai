import type { InterviewIOPort } from '../application/index.js'

export interface InterviewReadline extends AsyncIterable<string> {
  setPrompt(prompt: string): void
  prompt(preserveCursor?: boolean): void
}

export type InterviewOutput = (message: string) => void

const INTERVIEW_SUBMIT_COMMAND = '/done'

/**
 * Readline 访谈适配器把终端行流聚合成一次完整回答。
 * 普通换行和空白行都属于答案内容，只有显式提交命令才结束当前回答，
 * 因此包含空白行的代码、列表和长文本也可以原样进入访谈记录。
 */
export class ReadlineInterviewIO implements InterviewIOPort {
  private readonly lines: AsyncIterator<string>

  constructor(
    private readonly readline: InterviewReadline,
    private readonly writeLine: InterviewOutput = (message) => console.log(message),
  ) {
    this.lines = readline[Symbol.asyncIterator]()
  }

  async ask(question: string): Promise<string> {
    this.writeLine(`\nClaude：${question}`)
    this.writeLine(`你（支持多行输入；单独输入 ${INTERVIEW_SUBMIT_COMMAND} 提交）：`)

    const answerLines: string[] = []
    for (;;) {
      this.readline.setPrompt(answerLines.length === 0 ? '你> ' : '... ')
      this.readline.prompt()
      const line = await this.lines.next()

      if (line.done) {
        if (answerLines.length === 0) throw new Error('终端输入已结束，无法继续访谈')
        return answerLines.join('\n')
      }
      if (line.value.trim() === INTERVIEW_SUBMIT_COMMAND) return answerLines.join('\n')
      answerLines.push(line.value)
    }
  }
}
