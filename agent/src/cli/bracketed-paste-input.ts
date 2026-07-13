import { Transform, type TransformCallback } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import type { ReadStream, WriteStream } from 'node:tty'

const BRACKETED_PASTE_START = '\u001B[200~'
const BRACKETED_PASTE_END = '\u001B[201~'
const PASTED_CONTROL_MARK = '↵'
const PASTED_NEWLINE_CODE = `${PASTED_CONTROL_MARK}n`
const PASTED_LITERAL_MARK_CODE = `${PASTED_CONTROL_MARK}p`
const ENABLE_BRACKETED_PASTE = '\u001B[?2004h'
const DISABLE_BRACKETED_PASTE = '\u001B[?2004l'

/**
 * 解码器只负责识别标准 bracketed paste 边界并保护粘贴块中的换行。
 * 标记可能跨越任意输入块，回车和换行也可能被拆开，因此状态全部显式保存。
 */
export class BracketedPasteDecoder {
  private buffered = ''
  private insidePaste = false
  private pendingCarriageReturn = false

  push(input: string): string {
    this.buffered += input
    let output = ''

    for (;;) {
      const boundary = this.insidePaste ? BRACKETED_PASTE_END : BRACKETED_PASTE_START
      const boundaryIndex = this.buffered.indexOf(boundary)
      if (boundaryIndex >= 0) {
        const content = this.buffered.slice(0, boundaryIndex)
        output += this.insidePaste
          ? this.encodePastedContent(content, true)
          : escapeNewlineMarks(content)
        this.buffered = this.buffered.slice(boundaryIndex + boundary.length)
        this.insidePaste = !this.insidePaste
        continue
      }

      const retainedLength = matchingBoundaryPrefixLength(this.buffered, boundary)
      const consumableLength = this.buffered.length - retainedLength
      const content = this.buffered.slice(0, consumableLength)
      output += this.insidePaste
        ? this.encodePastedContent(content, false)
        : escapeNewlineMarks(content)
      this.buffered = this.buffered.slice(consumableLength)
      return output
    }
  }

  finish(): string {
    const content = this.buffered
    this.buffered = ''
    const output = this.insidePaste
      ? this.encodePastedContent(content, true)
      : escapeNewlineMarks(content)
    this.insidePaste = false
    return output
  }

  private encodePastedContent(content: string, final: boolean): string {
    let normalized = `${this.pendingCarriageReturn ? '\r' : ''}${content}`
    this.pendingCarriageReturn = false
    if (!final && normalized.endsWith('\r')) {
      normalized = normalized.slice(0, -1)
      this.pendingCarriageReturn = true
    }

    return escapeNewlineMarks(normalized)
      .replace(/\r\n|\r|\n/g, PASTED_NEWLINE_CODE)
  }
}

/**
 * Transform 保留 Node Readline 的行编辑能力，只改写 bracketed paste 数据。
 * 原始终端的 raw mode 由 Readline 控制，这里只把调用转交给真实 stdin。
 */
export class BracketedPasteInput extends Transform {
  readonly isTTY: boolean
  private readonly textDecoder = new StringDecoder('utf8')
  private readonly pasteDecoder = new BracketedPasteDecoder()

  constructor(private readonly terminalInput: ReadStream) {
    super()
    this.isTTY = terminalInput.isTTY
  }

  setRawMode(mode: boolean): this {
    if (this.terminalInput.isTTY) this.terminalInput.setRawMode(mode)
    return this
  }

  override _transform(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const text = typeof chunk === 'string' ? chunk : this.textDecoder.write(chunk)
    callback(null, this.pasteDecoder.push(text))
  }

  override _flush(callback: TransformCallback): void {
    const decodedTail = this.textDecoder.end()
    callback(null, `${this.pasteDecoder.push(decodedTail)}${this.pasteDecoder.finish()}`)
  }
}

/**
 * 终端模式切换集中封装，调用方只在 TTY 会话的创建和销毁边界调用。
 * 关闭序列必须与开启序列成对发送，避免命令退出后污染用户的 PowerShell 会话。
 */
export function setBracketedPasteMode(output: WriteStream, enabled: boolean): void {
  output.write(enabled ? ENABLE_BRACKETED_PASTE : DISABLE_BRACKETED_PASTE)
}

/**
 * Readline 返回答案后按显式控制码还原粘贴换行和用户原文中的标记字符。
 * 换行与原始标记使用不同后缀，因此连续空白行不会产生编码歧义。
 */
export function restorePastedNewlines(answer: string): string {
  let restored = ''
  for (let index = 0; index < answer.length; index += 1) {
    const character = answer[index]
    if (character !== PASTED_CONTROL_MARK) {
      restored += character
      continue
    }
    const code = answer[index + 1]
    if (code === 'p') {
      restored += PASTED_CONTROL_MARK
      index += 1
    } else if (code === 'n') {
      restored += '\n'
      index += 1
    } else {
      restored += PASTED_CONTROL_MARK
    }
  }
  return restored
}

function matchingBoundaryPrefixLength(input: string, boundary: string): number {
  const maximum = Math.min(input.length, boundary.length - 1)
  for (let length = maximum; length > 0; length -= 1) {
    if (boundary.startsWith(input.slice(-length))) return length
  }
  return 0
}

function escapeNewlineMarks(input: string): string {
  return input.replaceAll(PASTED_CONTROL_MARK, PASTED_LITERAL_MARK_CODE)
}
