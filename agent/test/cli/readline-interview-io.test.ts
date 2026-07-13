import { describe, expect, it } from 'vitest'
import { BracketedPasteDecoder } from '../../src/cli/bracketed-paste-input.js'
import {
  ReadlineInterviewIO,
  type InterviewReadline,
} from '../../src/cli/readline-interview-io.js'

/**
 * Fake Readline 按调用顺序返回完整逻辑答案。
 * 行编辑和粘贴边界属于更下层输入流职责，本测试只验证访谈适配器的交互协议。
 */
class FakeReadline implements InterviewReadline {
  readonly questions: string[] = []
  private index = 0

  constructor(private readonly answers: readonly (string | Error)[]) {}

  question(query: string): Promise<string> {
    this.questions.push(query)
    const answer = this.answers[this.index]
    this.index += 1
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer ?? '')
  }
}

describe('ReadlineInterviewIO', () => {
  it('普通回答按一次 Enter 直接提交', async () => {
    const readline = new FakeReadline(['这是普通回答'])
    const output: string[] = []
    const io = new ReadlineInterviewIO(readline, (message) => output.push(message))

    const answer = await io.ask('是否只展示地图？')

    expect(answer).toBe('这是普通回答')
    expect(readline.questions).toEqual(['你：'])
    expect(output).toEqual(['\nClaude：是否只展示地图？'])
  })

  it('把粘贴块中的换行和原始换行标记还原到答案', async () => {
    const decoder = new BracketedPasteDecoder()
    const encoded = decoder.push('\u001B[200~第一行\n第二行包含↵字符\u001B[201~')
    const readline = new FakeReadline([encoded])
    const io = new ReadlineInterviewIO(readline, () => undefined)

    await expect(io.ask('请粘贴代码')).resolves.toBe('第一行\n第二行包含↵字符')
  })

  it('连续问答各自调用一次 Readline 且不会串回答', async () => {
    const readline = new FakeReadline(['第一个答案', '第二个答案'])
    const io = new ReadlineInterviewIO(readline, () => undefined)

    const first = await io.ask('第一个问题')
    const second = await io.ask('第二个问题')

    expect(first).toBe('第一个答案')
    expect(second).toBe('第二个答案')
    expect(readline.questions).toEqual(['你：', '你：'])
  })

  it('Readline 关闭或取消时保留原始错误', async () => {
    const readline = new FakeReadline([new Error('输入已取消')])
    const io = new ReadlineInterviewIO(readline, () => undefined)

    await expect(io.ask('问题')).rejects.toThrow('输入已取消')
  })
})
