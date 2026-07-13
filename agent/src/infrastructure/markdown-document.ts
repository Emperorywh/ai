import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export interface MarkdownDocument {
  readonly frontmatter: unknown
  readonly body: string
}

/**
 * 解析最小 YAML frontmatter 协议。
 * 任务状态修改时正文原样保留，避免工作流写入破坏需求内容。
 */
export function parseMarkdownDocument(source: string): MarkdownDocument {
  const matched = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!matched) throw new Error('Markdown 文档缺少合法 YAML frontmatter')
  return {
    frontmatter: parseYaml(matched[1] ?? ''),
    body: matched[2] ?? '',
  }
}

/**
 * 序列化统一由一个函数完成，保证任务创建与状态更新使用相同协议。
 * YAML 只保存机器状态，需求内容继续使用易读的 Markdown 正文。
 */
export function serializeMarkdownDocument(frontmatter: unknown, body: string): string {
  const yaml = stringifyYaml(frontmatter).trimEnd()
  return `---\n${yaml}\n---\n\n${body.trim()}\n`
}
