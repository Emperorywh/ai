/**
 * path-audit 纯函数测试(TASK-040 / SPEC FR-039 / AC-011 / 任务 §11)。
 *
 * 覆盖 §11 验收:
 *   - allowed 祖先目录、具体文件、glob 行为有正反测试。
 *   - forbidden 优先,任一命中都阻止完成(即使同时落在 allowed 内)。
 *   - 路径规范化兼容 Windows 反斜杠 / 尾部斜杠;按路径段比较(非裸字符串前缀)。
 *   - 结构化返回 violations(ok=false 时非空)。
 */
import { describe, expect, it } from 'vitest'
import { auditPaths } from '../../../src/application/execution/path-audit.js'

describe('path-audit — allowed 祖先目录', () => {
  it('后代文件落在祖先目录内 → ok', () => {
    const out = auditPaths({
      changedFiles: ['src/foo/bar.ts', 'src/baz.ts'],
      allowedPaths: ['src/'],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(true)
    expect(out.violations).toEqual([])
  })

  it('allowed 去尾部斜杠后仍作为祖先匹配(src 与 src/ 等价)', () => {
    const out = auditPaths({
      changedFiles: ['src/a.ts'],
      allowedPaths: ['src'],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(true)
  })

  it('落在 allowed 目录之外 → out-of-scope 违规', () => {
    const out = auditPaths({
      changedFiles: ['docs/readme.md'],
      allowedPaths: ['src/'],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(false)
    expect(out.violations).toHaveLength(1)
    expect(out.violations[0]?.kind).toBe('out-of-scope')
    expect(out.violations[0]?.path).toBe('docs/readme.md')
  })
})

describe('path-audit — allowed 具体文件', () => {
  it('变更文件与 allowed 具体文件完全相同 → ok', () => {
    const out = auditPaths({
      changedFiles: ['src/foo.ts'],
      allowedPaths: ['src/foo.ts'],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(true)
  })

  it('变更文件是 allowed 具体文件的同级(非后代)→ out-of-scope', () => {
    const out = auditPaths({
      changedFiles: ['src/bar.ts'],
      allowedPaths: ['src/foo.ts'],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(false)
    expect(out.violations[0]?.kind).toBe('out-of-scope')
  })
})

describe('path-audit — 按路径段比较(非裸字符串前缀)', () => {
  it('src/foo 不是 src/foo-bar/x 的祖先 → out-of-scope', () => {
    const out = auditPaths({
      changedFiles: ['src/foo-bar/x.ts'],
      allowedPaths: ['src/foo'],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(false)
    expect(out.violations[0]?.kind).toBe('out-of-scope')
  })

  it('src/foo 是 src/foo/x.ts 的祖先 → ok', () => {
    const out = auditPaths({
      changedFiles: ['src/foo/x.ts'],
      allowedPaths: ['src/foo'],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(true)
  })
})

describe('path-audit — glob 匹配', () => {
  it('** 跨层匹配:src/**/*.ts 命中嵌套 .ts 文件', () => {
    const out = auditPaths({
      changedFiles: ['src/a/b/c.ts'],
      allowedPaths: ['src/**/*.ts'],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(true)
  })

  it('** 不匹配非 .ts 文件 → out-of-scope', () => {
    const out = auditPaths({
      changedFiles: ['src/a/b.js'],
      allowedPaths: ['src/**/*.ts'],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(false)
    expect(out.violations[0]?.kind).toBe('out-of-scope')
  })

  it('单层 * 不跨目录:src/* 匹配 src/a.ts 但不匹配 src/d/a.ts', () => {
    const direct = auditPaths({
      changedFiles: ['src/a.ts'],
      allowedPaths: ['src/*'],
      forbiddenPaths: [],
    })
    expect(direct.ok).toBe(true)

    const nested = auditPaths({
      changedFiles: ['src/d/a.ts'],
      allowedPaths: ['src/*'],
      forbiddenPaths: [],
    })
    expect(nested.ok).toBe(false)
  })

  it('? 匹配单字符:src/a?.ts 命中 src/ab.ts 不命中 src/abc.ts', () => {
    const match = auditPaths({
      changedFiles: ['src/ab.ts'],
      allowedPaths: ['src/a?.ts'],
      forbiddenPaths: [],
    })
    expect(match.ok).toBe(true)

    const noMatch = auditPaths({
      changedFiles: ['src/abc.ts'],
      allowedPaths: ['src/a?.ts'],
      forbiddenPaths: [],
    })
    expect(noMatch.ok).toBe(false)
  })

  it('glob 中路径合法字符 . 不被当正则元字符(src/foo.ts 精确 glob)', () => {
    const out = auditPaths({
      changedFiles: ['src/fooxats'], // 若 . 被当通配会误命中 src/foo.ts
      allowedPaths: ['src/foo.ts'],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(false) // 字面 . 不匹配 x
  })
})

describe('path-audit — forbidden 优先', () => {
  it('变更同时落在 allowed 与 forbidden → forbidden 违规(§11 验收)', () => {
    const out = auditPaths({
      changedFiles: ['src/secret.ts'],
      allowedPaths: ['src/'],
      forbiddenPaths: ['src/secret.ts'],
    })
    expect(out.ok).toBe(false)
    expect(out.violations).toHaveLength(1)
    expect(out.violations[0]?.kind).toBe('forbidden')
    expect(out.violations[0]?.matchedPattern).toBe('src/secret.ts')
  })

  it('forbidden 目录命中其后代文件', () => {
    const out = auditPaths({
      changedFiles: ['secrets/api-key.txt'],
      allowedPaths: ['src/'],
      forbiddenPaths: ['secrets/'],
    })
    expect(out.ok).toBe(false)
    expect(out.violations[0]?.kind).toBe('forbidden')
  })

  it('任一 forbidden 命中即阻止完成(多文件混合)', () => {
    const out = auditPaths({
      changedFiles: ['src/a.ts', 'secrets/leak.txt', 'src/b.ts'],
      allowedPaths: ['src/'],
      forbiddenPaths: ['secrets/'],
    })
    expect(out.ok).toBe(false)
    expect(out.violations).toHaveLength(1)
    expect(out.violations[0]?.path).toBe('secrets/leak.txt')
  })
})

describe('path-audit — 路径规范化(Windows/POSIX)', () => {
  it('Windows 反斜杠路径规范化后按正斜杠比较', () => {
    const out = auditPaths({
      changedFiles: ['src\\foo\\bar.ts'],
      allowedPaths: ['src/'],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(true)
    // 违规记录的 path 已规范化为正斜杠。
    expect(out.violations).toEqual([])
  })

  it('allowed 反斜杠形态与变更正斜杠形态一致命中', () => {
    const out = auditPaths({
      changedFiles: ['src/x.ts'],
      allowedPaths: ['src\\x.ts'],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(true)
  })

  it('尾部冗余斜杠不影响祖先判定', () => {
    const out = auditPaths({
      changedFiles: ['src///deep//a.ts'], // 变更路径内的多余斜杠:normalize 只去尾部,不去中间
      allowedPaths: ['src/'],
      forbiddenPaths: [],
    })
    // 中间多余斜杠不去除(与 core normalizePath 一致):src///deep 不以 src/ 为前缀边界
    // 的严格判定下仍命中(src///deep//a.ts startsWith src/ → true)。验证保守放行不越界。
    expect(out.ok).toBe(true)
  })
})

describe('path-audit — 边界', () => {
  it('空变更清单 → ok(无改动不越界)', () => {
    const out = auditPaths({
      changedFiles: [],
      allowedPaths: ['src/'],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(true)
    expect(out.violations).toEqual([])
  })

  it('空 allowed + 有变更 → 全部 out-of-scope', () => {
    const out = auditPaths({
      changedFiles: ['a.ts', 'b.ts'],
      allowedPaths: [],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(false)
    expect(out.violations).toHaveLength(2)
    expect(out.violations.every((v) => v.kind === 'out-of-scope')).toBe(true)
  })

  it('规范化后为空的变更路径被跳过(不计数也不放行)', () => {
    const out = auditPaths({
      changedFiles: ['   ', ''],
      allowedPaths: ['src/'],
      forbiddenPaths: [],
    })
    expect(out.ok).toBe(true) // 噪声跳过,无有效变更
    expect(out.violations).toEqual([])
  })

  it('结构化违规清单含路径与命中模式(供 ISSUES 提议定位)', () => {
    const out = auditPaths({
      changedFiles: ['out/x.ts'],
      allowedPaths: ['src/'],
      forbiddenPaths: [],
    })
    expect(out.violations[0]).toEqual({
      path: 'out/x.ts',
      kind: 'out-of-scope',
      matchedPattern: '',
    })
  })
})
