import { describe, expect, it } from 'vitest'
import {
  BracketedPasteDecoder,
  restorePastedNewlines,
} from '../../src/cli/bracketed-paste-input.js'

describe('BracketedPasteDecoder', () => {
  it('普通键盘输入保持不变并保护原始标记字符', () => {
    const decoder = new BracketedPasteDecoder()
    const encoded = `${decoder.push('普通↵回答')}${decoder.push('\r')}`

    expect(encoded).toBe('普通↵p回答\r')
    expect(restorePastedNewlines(encoded.slice(0, -1))).toBe('普通↵回答')
  })

  it('跨输入块识别粘贴边界并保护 CRLF 和 LF', () => {
    const decoder = new BracketedPasteDecoder()
    const output = [
      decoder.push('\u001B[20'),
      decoder.push('0~第一行\r'),
      decoder.push('\n第二行\n第三行\u001B[20'),
      decoder.push('1~\r'),
      decoder.finish(),
    ].join('')

    expect(output).toBe('第一行↵n第二行↵n第三行\r')
    expect(restorePastedNewlines(output.slice(0, -1))).toBe('第一行\n第二行\n第三行')
  })

  it('转义粘贴内容中原本存在的换行标记字符', () => {
    const decoder = new BracketedPasteDecoder()
    const encoded = decoder.push('\u001B[200~前↵后\n末尾\u001B[201~')

    expect(encoded).toBe('前↵p后↵n末尾')
    expect(restorePastedNewlines(encoded)).toBe('前↵后\n末尾')
  })

  it('连续空白行使用独立换行控制码无损还原', () => {
    const decoder = new BracketedPasteDecoder()
    const encoded = decoder.push('\u001B[200~第一行\n\n\n第四行\u001B[201~')

    expect(encoded).toBe('第一行↵n↵n↵n第四行')
    expect(restorePastedNewlines(encoded)).toBe('第一行\n\n\n第四行')
  })
})
