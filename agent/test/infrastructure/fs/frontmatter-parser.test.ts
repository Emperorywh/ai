import { describe, expect, it } from 'vitest'
import { parseDocument, serializeDocument } from '../../../src/infrastructure/index.js'

/* ============================================================ *
 * 夹具：典型 frontmatter（任务 / .result.md 模板字段子集）
 * ============================================================ */

/** 镜像 Readme §9 任务 frontmatter 的字段子集，用于真实结构 round-trip。 */
const TASK_FM = {
  id: 'TASK-010',
  title: 'Infra frontmatter 解析器',
  status: 'draft',
  layer: 'data',
  depends_on: ['TASK-001'],
  allowed_paths: ['src/infrastructure/fs/frontmatter-parser.ts'],
  forbidden_paths: ['src/core'],
  permissions: [] as string[],
  no_review: false,
  restart_on_retry: false,
}

const TASK_BODY = `# TASK-010 Infra frontmatter 解析器

## 1. 背景

来自 PLAN P2。

## 2. 当前目标

实现 parseDocument 与 serializeDocument。
`

/* ============================================================ *
 * parseDocument —— 含 frontmatter
 * ============================================================ */

describe('parseDocument：含 frontmatter', () => {
  it('正确拆分首部 YAML 围栏与正文', () => {
    const parsed = parseDocument(serializeDocument(TASK_FM, TASK_BODY))
    expect(parsed.frontmatter).toEqual(TASK_FM)
    expect(parsed.body).toBe(TASK_BODY)
  })

  it('支持列表 / 布尔 / 嵌套对象等 YAML 值', () => {
    const fm = {
      tags: ['a', 'b', 'c'],
      flags: { nested: true, count: 3 },
      empty_list: [] as string[],
    }
    const parsed = parseDocument(serializeDocument(fm, '正文'))
    expect(parsed.frontmatter).toEqual(fm)
    expect(parsed.body).toBe('正文')
  })

  it('frontmatter 为空围栏（---\\n---）→ frontmatter 为 null', () => {
    const parsed = parseDocument('---\n---\n正文')
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.body).toBe('正文')
  })

  it('frontmatter 后无正文 → body 为空串', () => {
    const parsed = parseDocument('---\nfoo: bar\n---\n')
    expect(parsed.frontmatter).toEqual({ foo: 'bar' })
    expect(parsed.body).toBe('')
  })

  it('闭合围栏后无换行直接到正文结尾', () => {
    const parsed = parseDocument('---\nfoo: bar\n---\n# Title')
    expect(parsed.frontmatter).toEqual({ foo: 'bar' })
    expect(parsed.body).toBe('# Title')
  })
})

/* ============================================================ *
 * parseDocument —— 不含 frontmatter
 * ============================================================ */

describe('parseDocument：不含 frontmatter', () => {
  it('纯 Markdown 文档 → frontmatter 为 null，body 为原文', () => {
    const raw = '# Title\n\n正文内容\n'
    const parsed = parseDocument(raw)
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.body).toBe(raw)
  })

  it('空文档 → frontmatter 为 null，body 为空串', () => {
    const parsed = parseDocument('')
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.body).toBe('')
  })

  it('首行非 ---（--- 不在首行）→ 整篇作为 body，不被误判为开围栏', () => {
    const raw = '不是围栏\n---\nfoo: bar\n'
    const parsed = parseDocument(raw)
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.body).toBe(raw)
  })

  it('有开围栏但无闭合围栏 → 视为无 frontmatter，原文为 body', () => {
    const raw = '---\n\n正文内容\n'
    const parsed = parseDocument(raw)
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.body).toBe(raw)
  })
})

/* ============================================================ *
 * parseDocument —— 正文内含 ---（水平线）不被误判为首部围栏
 * ============================================================ */

describe('parseDocument：正文内含 --- 不被误判', () => {
  it('正文中的 Markdown 水平线 --- 保留在 body 内', () => {
    const fm = { id: 'TASK-010' }
    const body = '段落一\n\n---\n\n段落二\n'
    const parsed = parseDocument(serializeDocument(fm, body))
    expect(parsed.frontmatter).toEqual(fm)
    expect(parsed.body).toBe(body)
  })

  it('首行 --- 但其后无闭合围栏（水平线起手）→ 整篇为 body', () => {
    const raw = '---\n\n正文\n'
    const parsed = parseDocument(raw)
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.body).toBe(raw)
  })

  it('frontmatter 后正文以 --- 水平线开头 → 仍属正文', () => {
    const doc = '---\nid: TASK-010\n---\n---\n正文\n'
    const parsed = parseDocument(doc)
    expect(parsed.frontmatter).toEqual({ id: 'TASK-010' })
    expect(parsed.body).toBe('---\n正文\n')
  })
})

/* ============================================================ *
 * parseDocument —— CRLF / LF 兼容
 * ============================================================ */

describe('parseDocument：CRLF 兼容', () => {
  it('CRLF 行尾的 frontmatter 正确解析，body 保留 CRLF 原样', () => {
    const parsed = parseDocument('---\r\nfoo: bar\r\nbaz: qux\r\n---\r\n正文\r\n')
    expect(parsed.frontmatter).toEqual({ foo: 'bar', baz: 'qux' })
    expect(parsed.body).toBe('正文\r\n')
  })

  it('CRLF 下首行 ---\\r\\n 被识别为开围栏', () => {
    const parsed = parseDocument('---\r\nkey: value\r\n---\r\ntext')
    expect(parsed.frontmatter).toEqual({ key: 'value' })
    expect(parsed.body).toBe('text')
  })

  it('CRLF 下空围栏 → frontmatter 为 null', () => {
    const parsed = parseDocument('---\r\n---\r\ntext')
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.body).toBe('text')
  })
})

/* ============================================================ *
 * parseDocument —— YAML 语法非法时抛错（不静默吞错）
 * ============================================================ */

describe('parseDocument：非法 YAML 抛错', () => {
  it('围栏内 YAML 未闭合流式集合 → 抛错', () => {
    expect(() => parseDocument('---\nfoo: [unclosed\n---\n正文')).toThrow()
  })
})

/* ============================================================ *
 * serializeDocument —— 格式
 * ============================================================ */

describe('serializeDocument：格式', () => {
  it('产出 ---\\n<yaml>\\n---\\n<body> 结构', () => {
    expect(serializeDocument({ foo: 'bar' }, '正文')).toBe('---\nfoo: bar\n---\n正文')
  })

  it('frontmatter 为 null → 不输出围栏，直接返回 body', () => {
    expect(serializeDocument(null, '正文')).toBe('正文')
  })

  it('frontmatter 为 undefined → 同 null，不输出围栏', () => {
    expect(serializeDocument(undefined, '正文')).toBe('正文')
  })
})

/* ============================================================ *
 * round-trip：parseDocument(serializeDocument(f, b)) 深度相等（§8）
 * ============================================================ */

describe('round-trip：parse ∘ serialize 深度相等', () => {
  it('典型任务 frontmatter + 正文 round-trip', () => {
    const parsed = parseDocument(serializeDocument(TASK_FM, TASK_BODY))
    expect(parsed.frontmatter).toEqual(TASK_FM)
    expect(parsed.body).toBe(TASK_BODY)
  })

  it('正文无尾换行 round-trip', () => {
    const fm = { a: 1, b: 'two' }
    const body = 'no trailing newline'
    const parsed = parseDocument(serializeDocument(fm, body))
    expect(parsed.frontmatter).toEqual(fm)
    expect(parsed.body).toBe(body)
  })

  it('正文为空 round-trip', () => {
    const fm = { id: 'TASK-010' }
    const parsed = parseDocument(serializeDocument(fm, ''))
    expect(parsed.frontmatter).toEqual(fm)
    expect(parsed.body).toBe('')
  })

  it('null frontmatter round-trip（不输出围栏）', () => {
    const parsed = parseDocument(serializeDocument(null, TASK_BODY))
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.body).toBe(TASK_BODY)
  })

  it('列表 / 嵌套对象 round-trip', () => {
    const fm = {
      depends_on: ['TASK-001', 'TASK-002'],
      nested: { deep: { value: 42 } },
      flags: [true, false],
    }
    const parsed = parseDocument(serializeDocument(fm, '正文'))
    expect(parsed.frontmatter).toEqual(fm)
    expect(parsed.body).toBe('正文')
  })

  it('空对象 frontmatter round-trip', () => {
    const parsed = parseDocument(serializeDocument({}, '正文'))
    expect(parsed.frontmatter).toEqual({})
    expect(parsed.body).toBe('正文')
  })
})
