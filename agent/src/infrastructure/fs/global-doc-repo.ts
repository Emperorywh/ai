/**
 * Infrastructure 全局文档仓储与 section 合并（Readme.md §3.2 / §6.5 / §6.6 / §6.7）。
 *
 * 本仓储是全局工作流状态文档（PROGRESS / DECISIONS / ISSUES）合并回写的**底层操作**
 * （任务 §9：输入「全局文档现状 + 一条 update」→ 输出「合并后文档」）。所有方法以文档
 * 完整内容（含 frontmatter）字符串为输入、返回合并后的完整文档字符串——文件 I/O 与合并
 * 编排归 application 层 TASK-020：Orchestrator 基于最新主分支重读全局文档，逐条调用本
 * 仓储合并 global_update_requests 后串行写回，避免多 worktree 并发写同一文件（§3.2）。
 *
 * 设计约束（任务 §2 / §7 / §8）：
 *   - 依赖 core 的 DecisionSchema / IssueSchema（校验条目机器字段）+ frontmatter-parser
 *     （拆分 frontmatter 与正文：frontmatter 原样保留，只修改正文 section / 条目）。
 *   - section 定位基于 Markdown 标题层级（## / ###）：trim 后精确匹配标题文本，section
 *     边界取「下一个同级或更高级标题」（§12：避免误合并相邻 section，子节不截断父节）。
 *   - decisions / issues 用 fenced YAML block 表达机器字段（§6.6 / §6.7 接受的格式之一，
 *     与现有 DECISIONS.md / ISSUES.md 实际结构一致），按 id 去重：同 id 再追加 = 更新。
 *
 * 方法语义（任务 §2 / §9）：
 *   - applyProgressUpdate：按 mode(replace/append) + section 合并 PROGRESS 正文 section。
 *   - appendDecision / appendIssue：按 id 去重追加；命中既有 id 则替换其「标题 + yaml
 *     block」（保留其后人工 prose），未命中则在文末追加新条目（--- 分隔 + 标题 + fenced yaml）。
 *   - readDecisions / readIssues：解析正文内全部 fenced yaml block，Schema 校验后返回数组。
 *
 * 不做（任务 §7）：冲突仲裁（多条 replace 命中同 section 由 Orchestrator 落 ISSUES）、
 *   decision/issue 的 id 分配（application 层 TASK-020）。
 *
 * 权威来源：根目录 Readme.md §3.2（合并策略）/ §6.5（PROGRESS）/ §6.6（DECISIONS）/ §6.7（ISSUES）。
 */
import { z } from 'zod'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  DecisionSchema,
  IssueSchema,
  type Decision,
  type Issue,
  type ProgressUpdateRequest,
} from '../../core/index.js'
import { parseDocument, serializeDocument } from './frontmatter-parser.js'

/* ============================================================ *
 * 类型
 * ============================================================ */

/** Markdown 标题（## / ### 等）。 */
interface Heading {
  level: number
  text: string
}

/** section 在正文行数组中的定位。 */
interface SectionLocation {
  /** 标题行索引（含）。 */
  headingIdx: number
  /** 标题层级（# 数量）。 */
  level: number
  /** 内容起始行索引（标题行的下一行）。 */
  contentStart: number
  /** 内容结束行索引（下一个同级或更高级标题，独占；无则 = lines.length）。 */
  contentEnd: number
}

/** fenced 代码块（```yaml ... ```）在行数组中的定位。 */
interface CodeBlock {
  /** 开围栏 ```yaml 行索引。 */
  openIdx: number
  /** 闭围栏 ``` 行索引。 */
  closeIdx: number
  /** 围栏内原始 YAML 文本。 */
  yaml: string
}

/** 既有条目（标题 + yaml block）的行范围，用于按 id 更新时定位替换。 */
interface EntrySpan {
  /** 起始行（标题行；无标题则 = yaml 开围栏行）。 */
  startIdx: number
  /** 结束行（yaml 闭围栏行，含）。 */
  endIdx: number
}

/* ============================================================ *
 * GlobalDocRepository
 * ============================================================ */

/**
 * 全局文档仓储：对 PROGRESS / DECISIONS / ISSUES 正文做 section 级合并的纯变换。
 *
 * 所有方法以文档完整内容（含 frontmatter）字符串为输入、返回合并后的完整文档字符串；
 * frontmatter 经 frontmatter-parser 拆出后原样保留，只修改正文 section / 条目。本类无
 * 可变状态（纯变换），保留 class 形态以贴合 application 层 Port 约定（ARCHITECTURE.md §4），
 * 由 cli 在 composition root 处 wiring 注入。
 */
export class GlobalDocRepository {
  /* ---------- PROGRESS section 合并（§3.2 / §6.5） ---------- */

  /**
   * 按 mode(replace/append) + section 合并 PROGRESS 正文 section（§3.2）。
   *
   * - replace：整段替换目标 section 内容（标题保留）。
   * - append：拼接到目标 section 末尾。
   * - section 不存在：按 §8「缺失 section 视为新建」，在文末追加新 section（两种 mode 同行为）。
   */
  applyProgressUpdate(doc: string, update: ProgressUpdateRequest): string {
    const { frontmatter, body } = parseDocument(doc)
    const lines = toLines(body)
    const location = findSection(lines, update.section)
    const contentLines = update.content.split(/\r?\n/)
    const newBody =
      location === null
        ? createSection(lines, update.section, contentLines)
        : update.mode === 'replace'
          ? replaceSection(lines, location, contentLines)
          : appendSection(lines, location, contentLines)
    return serializeDocument(frontmatter, newBody)
  }

  /* ---------- DECISIONS / ISSUES 条目合并（§3.2 / §6.6 / §6.7） ---------- */

  /**
   * 按 id 去重追加决策（§11：同 id 再追加 = 更新）。
   *
   * - 命中既有同 id 条目：替换其「标题 + fenced yaml block」（保留其后人工 prose）。
   * - 未命中（含空 id 提议态）：在文末追加新条目（`---` 分隔 + `## <id> <title>` + fenced yaml）。
   */
  appendDecision(doc: string, decision: Decision): string {
    const headingLine = decision.id ? `## ${decision.id} ${decision.title}` : `## ${decision.title}`
    return this.mergeEntry(doc, DecisionSchema, decision.id, [
      headingLine,
      '',
      ...renderYamlFence(decision),
    ])
  }

  /** 按 id 去重追加问题，语义同 appendDecision。 */
  appendIssue(doc: string, issue: Issue): string {
    const headingLine = issue.id ? `## ${issue.id} ${issue.title}` : `## ${issue.title}`
    return this.mergeEntry(doc, IssueSchema, issue.id, [
      headingLine,
      '',
      ...renderYamlFence(issue),
    ])
  }

  /** 解析 DECISIONS 正文内全部 fenced yaml block，DecisionSchema 校验后返回数组（文档序）。 */
  readDecisions(doc: string): Decision[] {
    return this.readEntries(doc, DecisionSchema)
  }

  /** 解析 ISSUES 正文内全部 fenced yaml block，IssueSchema 校验后返回数组（文档序）。 */
  readIssues(doc: string): Issue[] {
    return this.readEntries(doc, IssueSchema)
  }

  /* ---------- 内部辅助 ---------- */

  /**
   * readDecisions / readIssues 共用：解析正文 fenced yaml block 并按 schema 校验。
   * 不能通过校验的块（非本类条目 / 损坏数据）被跳过——它们无法按 id 匹配，不参与去重。
   *
   * 用约束泛型 `<S extends z.ZodTypeAny>` + `z.infer<S>` 让返回元素类型由 schema 派生
   * （与 TaskDocRepository.readAndValidate 同模式，DEC-008）。
   */
  private readEntries<S extends z.ZodTypeAny>(doc: string, schema: S): z.infer<S>[] {
    const { body } = parseDocument(doc)
    const lines = toLines(body)
    const entries: z.infer<S>[] = []
    for (const block of findCodeBlocks(lines)) {
      let parsed: unknown
      try {
        parsed = parseYaml(block.yaml)
      } catch {
        continue
      }
      const result = schema.safeParse(parsed)
      if (result.success) {
        entries.push(result.data)
      }
    }
    return entries
  }

  /**
   * appendDecision / appendIssue 共用：按 id 去重合并条目。
   * 空 id（提议态）不匹配任何既有项，直接走文末追加。
   */
  private mergeEntry(
    doc: string,
    schema: z.ZodTypeAny,
    id: string,
    blockLines: string[],
  ): string {
    const { frontmatter, body } = parseDocument(doc)
    const lines = toLines(body)
    const existing = id !== '' ? findEntrySpan(lines, schema, id) : null
    const newBody =
      existing !== null
        ? replaceEntry(lines, existing, blockLines)
        : appendEntryBlock(lines, blockLines)
    return serializeDocument(frontmatter, newBody)
  }
}

/* ============================================================ *
 * 模块级纯辅助函数
 * ============================================================ */

/** 按行拆分正文（兼容 CRLF/LF，规范化为 LF）；空正文返回空数组。 */
function toLines(body: string): string[] {
  return body.length === 0 ? [] : body.split(/\r?\n/)
}

/** 识别 Markdown 标题行：`#{1,6}` + 至少一个空白 + 标题文本；返回层级与 trim 后文本。 */
function matchHeading(line: string): Heading | null {
  const matched = line.match(/^(#{1,6})\s+(.*)$/)
  if (matched === null) return null
  const hashes = matched[1]
  const text = matched[2] ?? ''
  if (hashes === undefined) return null
  return { level: hashes.length, text: text.trim() }
}

/**
 * 定位正文中的 section（按标题精确匹配，trim 后比较）。
 * 取第一个标题文本与 section 名称相等的 section；未找到返回 null（§12：精确匹配避免误并入）。
 */
function findSection(lines: string[], section: string): SectionLocation | null {
  const target = section.trim()
  for (let i = 0; i < lines.length; i++) {
    const heading = matchHeading(lines[i] ?? '')
    if (heading !== null && heading.text === target) {
      const contentEnd = findSectionEnd(lines, i + 1, heading.level)
      return { headingIdx: i, level: heading.level, contentStart: i + 1, contentEnd }
    }
  }
  return null
}

/** 从 fromIdx 起找下一个「同级或更高级」标题行索引（§12：子节 level 更深不截断父节）；无则 lines.length。 */
function findSectionEnd(lines: string[], fromIdx: number, headingLevel: number): number {
  for (let i = fromIdx; i < lines.length; i++) {
    const heading = matchHeading(lines[i] ?? '')
    if (heading !== null && heading.level <= headingLevel) {
      return i
    }
  }
  return lines.length
}

/** replace mode：整段替换 section 内容（标题保留，内容换为 contentLines）。 */
function replaceSection(
  lines: string[],
  location: SectionLocation,
  contentLines: string[],
): string {
  const before = lines.slice(0, location.contentStart) // 含标题
  const after = lines.slice(location.contentEnd) // 含下一个标题
  const result: string[] = [...before, '', ...contentLines]
  if (after.length > 0) {
    result.push('', ...after)
  } else {
    result.push('') // 末尾 section：补尾换行
  }
  return result.join('\n')
}

/** append mode：拼接到 section 末尾（先裁掉 section 内尾部空行，再接 contentLines）。 */
function appendSection(
  lines: string[],
  location: SectionLocation,
  contentLines: string[],
): string {
  let contentEnd = location.contentEnd
  while (contentEnd > location.contentStart && (lines[contentEnd - 1] ?? '').trim() === '') {
    contentEnd--
  }
  const before = lines.slice(0, contentEnd) // 标题 + 既有内容（去尾部空行）
  const after = lines.slice(location.contentEnd) // 含下一个标题
  const result: string[] = [...before, '', ...contentLines]
  if (after.length > 0) {
    result.push('', ...after)
  } else {
    result.push('')
  }
  return result.join('\n')
}

/** section 不存在：在文末新建 `## <section>` section（§8 缺失视为新建）。 */
function createSection(lines: string[], section: string, contentLines: string[]): string {
  const end = trimTrailingBlanks(lines)
  const head = lines.slice(0, end)
  return [...head, '', `## ${section.trim()}`, '', ...contentLines, ''].join('\n')
}

/** 收集正文内全部 fenced ```yaml 代码块（文档序）；开围栏无对应闭围栏则跳过。 */
function findCodeBlocks(lines: string[]): CodeBlock[] {
  const blocks: CodeBlock[] = []
  let i = 0
  while (i < lines.length) {
    if (isYamlOpen(lines[i] ?? '')) {
      let closeIdx = -1
      for (let j = i + 1; j < lines.length; j++) {
        if (isFenceClose(lines[j] ?? '')) {
          closeIdx = j
          break
        }
      }
      if (closeIdx === -1) {
        i += 1 // 残缺开围栏：跳过
      } else {
        const yaml = lines.slice(i + 1, closeIdx).join('\n')
        blocks.push({ openIdx: i, closeIdx, yaml })
        i = closeIdx + 1
      }
    } else {
      i += 1
    }
  }
  return blocks
}

/** ```yaml 开围栏（trim 后、大小写不敏感比较，兼容尾随空白）。 */
function isYamlOpen(line: string): boolean {
  return line.trim().toLowerCase() === '```yaml'
}

/** ``` 闭围栏（trim 后恰为三反引号）。 */
function isFenceClose(line: string): boolean {
  return line.trim() === '```'
}

/** 找 yaml 开围栏之前最近的 `##` 及更深层级标题行索引（跳过文档 `#` 大标题）。 */
function findPrecedingSectionHeading(lines: string[], beforeIdx: number): number | null {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    const heading = matchHeading(lines[i] ?? '')
    if (heading !== null && heading.level >= 2) {
      return i
    }
  }
  return null
}

/**
 * 按 id 定位既有条目（决策 / 问题）的行范围。遍历 fenced yaml block，schema 校验通过的
 * 视为同类条目，id 匹配则返回其「标题行 ~ yaml 闭围栏行」范围（无标题则从 yaml 开围栏起）。
 */
function findEntrySpan(
  lines: string[],
  schema: z.ZodTypeAny,
  id: string,
): EntrySpan | null {
  for (const block of findCodeBlocks(lines)) {
    let parsed: unknown
    try {
      parsed = parseYaml(block.yaml)
    } catch {
      continue
    }
    const result = schema.safeParse(parsed)
    if (!result.success) continue
    const existingId = (result.data as { id?: unknown }).id
    if (existingId === id) {
      const headingIdx = findPrecedingSectionHeading(lines, block.openIdx)
      return { startIdx: headingIdx ?? block.openIdx, endIdx: block.closeIdx }
    }
  }
  return null
}

/** 渲染 fenced yaml block 行：```yaml / <yaml 行> / ```（yaml.stringify 去 trailing 换行后按行拆）。 */
function renderYamlFence(obj: unknown): string[] {
  let yamlText = stringifyYaml(obj)
  if (yamlText.endsWith('\n')) yamlText = yamlText.slice(0, -1)
  return ['```yaml', ...yamlText.split(/\r?\n/), '```']
}

/** 命中既有 id 时：替换「标题 + yaml block」，保留其后人工 prose；确保结果以换行结尾。 */
function replaceEntry(lines: string[], span: EntrySpan, blockLines: string[]): string {
  const before = lines.slice(0, span.startIdx)
  const after = lines.slice(span.endIdx + 1)
  const joined = [...before, ...blockLines, ...after].join('\n')
  return joined.endsWith('\n') ? joined : joined + '\n'
}

/** 未命中时：在文末追加新条目（`---` 分隔 + 标题 + fenced yaml），补尾换行。 */
function appendEntryBlock(lines: string[], blockLines: string[]): string {
  const end = trimTrailingBlanks(lines)
  const head = lines.slice(0, end)
  return [...head, '', '---', '', ...blockLines, ''].join('\n')
}

/** 返回尾部连续空行之前的行索引（[end, lines.length) 全为空行 / trim 后为空）。 */
function trimTrailingBlanks(lines: string[]): number {
  let end = lines.length
  while (end > 0 && (lines[end - 1] ?? '').trim() === '') {
    end--
  }
  return end
}
