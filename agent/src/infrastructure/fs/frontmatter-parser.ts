/**
 * Infrastructure frontmatter 解析器（Readme.md §9 / §10 文档协议）。
 *
 * 文档协议 = Markdown 正文 + YAML frontmatter（§3.1）。所有文档仓储（TASK-011 任务文档 /
 * TASK-012 全局文档）都依赖本解析器把「首部 YAML 围栏」与「Markdown 正文」干净地拆开，
 * 再由上层用对应 core Schema 做 Zod 校验。本模块只做**结构解析 / 序列化**，不绑定任何具体
 * Schema、不做文件 I/O（任务 §7），只处理字符串。
 *
 * 设计约束（任务 §8 / §12）：
 *   - 纯字符串工具，**不依赖 core**（任务 §8「不依赖 core（纯字符串工具）」）。
 *   - 只认**首部**围栏：opening fence 必须是文档第一行（内容恰为 `---`），其后第一个内容
 *     恰为 `---` 的行视为 closing fence；正文内再出现的 `---`（如 Markdown 水平线）不被
 *     误判（§11 验收）。
 *   - CRLF / LF 兼容（§12 风险点）：行内容比对时统一去掉行尾 `\r\n` / `\n`。
 *   - 序列化稳定可 round-trip：`parseDocument(serializeDocument(f, b))` 与 `(f, b)` 深度相等
 *     （§8）。YAML 解析 / 序列化委托给既有 `yaml` 库。
 *
 * 权威来源：根目录 Readme.md §9（任务文件模板）/ §10（任务执行结果模板）。
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/** frontmatter 围栏标记。 */
const FENCE = '---'

/**
 * 解析结果：frontmatter 为首部 YAML 解析得到的值（无 frontmatter 时为 null），
 * body 为围栏之后的正文（原文保留，含其原始换行）。
 */
export interface ParsedDocument {
  readonly frontmatter: unknown
  readonly body: string
}

/**
 * 去掉单行行尾换行（兼容 `\r\n` / `\n`），用于围栏行内容比对。
 */
function lineContent(line: string): string {
  return line.replace(/\r?\n$/, '')
}

/**
 * 把原文按行拆分，每行**保留其行尾换行符**（`\n` 或 `\r\n`）；末行若无换行则为纯文本。
 * 空串返回空数组。手写扫描而非 `String.match`，规避可匹配空串的正则在全局匹配下产生
 * 末尾空元素的怪异行为，保证 body 精确还原。
 */
function toLines(raw: string): string[] {
  if (raw.length === 0) return []
  const lines: string[] = []
  let start = 0
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\n') {
      const end = i + 1
      lines.push(raw.slice(start, end))
      start = end
    }
  }
  if (start < raw.length) {
    // 末行无换行符
    lines.push(raw.slice(start))
  }
  return lines
}

/**
 * 解析文档：识别首部 `---\n...\n---` 围栏，围栏内 YAML 用 `yaml` 库解析，围栏后正文原样返回。
 *
 * - 无 frontmatter（空文档 / 首行非 `---` / 有开围栏但无闭合）→ `frontmatter: null`、`body: 原文`。
 * - 围栏内为空（`---\n---`）→ `frontmatter: null`。
 * - 正文内再出现的 `---` 因只取首部第一个闭合围栏而不被误判（§11）。
 * - YAML 语法非法时由 `yaml` 库抛错（不静默吞错，交上层仓储处理）。
 */
export function parseDocument(raw: string): ParsedDocument {
  const lines = toLines(raw)
  const first = lines[0]
  // 首行内容必须恰为围栏 ---，否则视为无 frontmatter
  if (first === undefined || lineContent(first) !== FENCE) {
    return { frontmatter: null, body: raw }
  }
  // 从第二行起找第一个内容恰为 --- 的行作为闭合围栏
  let closeIdx = -1
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line !== undefined && lineContent(line) === FENCE) {
      closeIdx = i
      break
    }
  }
  if (closeIdx === -1) {
    // 有开围栏但无闭合 → 视为无 frontmatter，原文作为正文
    return { frontmatter: null, body: raw }
  }
  const yamlText = lines.slice(1, closeIdx).join('')
  const frontmatter = yamlText === '' ? null : parseYaml(yamlText)
  // 闭合围栏之后的所有行（含其原始换行）即正文，原样拼接
  const body = lines.slice(closeIdx + 1).join('')
  return { frontmatter, body }
}

/**
 * 序列化文档：`---\n<yaml>\n---\n<body>`。
 *
 * - `frontmatter` 为 `null` / `undefined` → 不输出围栏，直接返回 `body`（与「无 frontmatter」
 *   解析结果对称，保证 round-trip）。
 * - YAML 序列化委托 `yaml.stringify`；确保围栏内 YAML 以换行结尾，使闭合围栏独占一行。
 */
export function serializeDocument(frontmatter: unknown, body: string): string {
  if (frontmatter === null || frontmatter === undefined) {
    return body
  }
  let yamlText = stringifyYaml(frontmatter)
  if (!yamlText.endsWith('\n')) {
    yamlText += '\n'
  }
  return `${FENCE}\n${yamlText}${FENCE}\n${body}`
}
