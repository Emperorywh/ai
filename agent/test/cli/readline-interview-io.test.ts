import { describe, expect, it } from 'vitest'
import {
  ReadlineInterviewIO,
  type InterviewReadline,
} from '../../src/cli/readline-interview-io.js'

/**
 * Fake Readline 只实现多行适配器依赖的行流和提示符协议。
 * 每个测试显式提供输入行，避免真实终端状态影响用例结果。
 */
class FakeReadline implements InterviewReadline, AsyncIterator<string> {
  readonly prompts: string[] = []
  private index = 0

  constructor(private readonly inputLines: readonly string[]) {}

  setPrompt(prompt: string): void {
    this.prompts.push(prompt)
  }

  prompt(): void {}

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return this
  }

  next(): Promise<IteratorResult<string>> {
    const value = this.inputLines[this.index]
    this.index += 1
    return Promise.resolve(
      value === undefined ? { done: true, value: undefined } : { done: false, value },
    )
  }
}

describe('ReadlineInterviewIO', () => {
  it('保留多行、缩进和空白行并用显式命令提交', async () => {
    const readline = new FakeReadline(['第一行', '', '  第三行保持缩进', '/done'])
    const output: string[] = []
    const io = new ReadlineInterviewIO(readline, (message) => output.push(message))

    const answer = await io.ask('请提供节点类型。')

    expect(answer).toBe('第一行\n\n  第三行保持缩进')
    expect(readline.prompts).toEqual(['你> ', '... ', '... ', '... '])
    expect(output).toEqual([
      '\nClaude：请提供节点类型。',
      '你（支持多行输入；单独输入 /done 提交）：',
    ])
  })

  it('连续访谈复用同一个行迭代器且不会串回答', async () => {
    const readline = new FakeReadline(['第一个答案', '/done', '第二个答案', '第二行', '/done'])
    const io = new ReadlineInterviewIO(readline, () => undefined)

    const first = await io.ask('第一个问题')
    const second = await io.ask('第二个问题')

    expect(first).toBe('第一个答案')
    expect(second).toBe('第二个答案\n第二行')
  })

  it('输入流结束时提交已经输入的内容', async () => {
    const readline = new FakeReadline(['尚未输入提交命令'])
    const io = new ReadlineInterviewIO(readline, () => undefined)

    await expect(io.ask('问题')).resolves.toBe('尚未输入提交命令')
  })

  it('没有任何内容时关闭输入流会给出明确错误', async () => {
    const readline = new FakeReadline([])
    const io = new ReadlineInterviewIO(readline, () => undefined)

    await expect(io.ask('问题')).rejects.toThrow('终端输入已结束，无法继续访谈')
  })
})
