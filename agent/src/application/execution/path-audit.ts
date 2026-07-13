/**
 * 工作区路径越界审计(串行编排 SPEC FR-039 / AC-011,任务 §2 / §8 / §11)。
 *
 * Executor 返回后,系统用 Git 实际变更复核模型是否修改了允许范围之外的文件——
 * 路径限制不能只作为提示词,执行后必须用 Git diff 再校验一次(FR-039)。
 *
 * 本模块是**纯函数**路径审计:输入「实际变更文件清单 + 任务 allowed/forbidden」,输出
 * 结构化违规清单(forbidden 命中 / 越界)。不感知 Git / 文件系统——变更枚举由
 * WorkspaceInspectionPort(infrastructure)采集后作为输入传入(任务 §8「越界结果必须
 * 结构化返回」/ §7「不自动删除越界文件」)。
 *
 * 匹配语义(§11 验收 + §8 路径规范化):
 *   - 路径规范化:统一反斜杠→正斜杠、去首尾空白与尾部冗余斜杠,兼容 Windows/POSIX。
 *   - 按路径段比较(非裸字符串前缀):`src/foo` 是 `src/foo/bar.ts` 的祖先,但不是
 *     `src/foo-bar/x` 的祖先(避免目录名前缀误判)。
 *   - allowed 支持三种形态:祖先目录(`src/` 匹配后代)、具体文件(相同路径)、glob
 *     通配(`*` 单层、`**` 跨层、`?` 单字符;例如 src 任意层目录下的 .ts 文件)。
 *   - forbidden 优先:任一变更命中 forbidden 即违规,即使同时落在 allowed 内。
 *   - allowed/forbidden 启动前已由 resolvePathScope(core)保证无重叠,故单文件不会
 *     同时合法命中二者;但仍可能既不在 allowed 也不在 forbidden(纯越界)。
 *
 * 设计约束(任务 §8 / AGENTS.md §2):
 *   - 纯函数,零反向依赖,不引入 zod / fs / child_process。
 *   - 路径工具(normalizePath / isAncestorOrEqual)与 core/rules/permission-rules.ts
 *     的同名私有函数同源(按路径段比较),但因 core 模块私有且本任务 allowed 不含 core,
 *     在此独立实现;二者语义一致,日后若 core 导出公共路径工具可统一(独立任务)。
 *
 * 权威来源:串行编排 SPEC FR-039(权限执行)/ AC-011(路径越界)/ §20.2(模块边界)。
 */

/* ============================================================ *
 * 输入输出类型
 * ============================================================ */

/** 路径审计输入:实际变更文件 + 任务声明的 allowed / forbidden 作用域。 */
export interface PathAuditInput {
  /** Git 工作区实际变更文件清单(相对 worktree 根,正斜杠;经 WorkspaceInspectionPort 采集)。 */
  readonly changedFiles: readonly string[]
  /** 任务 frontmatter allowed_paths(允许写入的作用域)。 */
  readonly allowedPaths: readonly string[]
  /** 任务 frontmatter forbidden_paths(禁止写入的作用域,deny 优先)。 */
  readonly forbiddenPaths: readonly string[]
}

/** 路径违规类型。 */
export type PathViolationKind =
  | 'forbidden' // 命中 forbidden_paths(deny 优先,§11 验收)
  | 'out-of-scope' // 既不在 allowed 内,属越界改动

/** 单条路径违规记录(结构化返回,§8「越界结果必须结构化返回,不能只打印 warning」)。 */
export interface PathViolation {
  /** 变更文件路径(已规范化为正斜杠)。 */
  readonly path: string
  /** 违规类型。 */
  readonly kind: PathViolationKind
  /** 命中的作用域模式(forbidden 命中时为匹配的 forbidden 条目;out-of-scope 时为空串)。 */
  readonly matchedPattern: string
}

/** 路径审计结果:passed(无违规)/ blocked(有违规,阻止完成,FR-020 合并前置条件)。 */
export interface PathAuditOutcome {
  /** true = 全部变更在 allowed 内且未命中 forbidden;false = 存在违规。 */
  readonly ok: boolean
  /** 违规清单(ok=false 时非空,供映射为 blocked + needs-human + ISSUES 提议)。 */
  readonly violations: readonly PathViolation[]
}

/* ============================================================ *
 * 路径工具(规范化 + 祖先判定 + glob)
 * ============================================================ */

/**
 * 规范化路径:去首尾空白、反斜杠统一为正斜杠、去尾部冗余斜杠。
 *
 * 与 core/rules/permission-rules.ts 同源:frontmatter 路径以正斜杠表达,规范化统一
 * Windows 反斜杠与尾部斜杠差异,使后续比较基于一致形态。空路径(规范化后为空)视为
 * 数据噪声,由调用方过滤。
 */
function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
}

/**
 * 判定 pattern 是否含 glob 元字符(`*` / `?`)。
 *
 * 含元字符 → 走 glob 正则匹配;否则走祖先/相同(路径段)匹配。
 */
function containsGlob(pattern: string): boolean {
  return /[*?]/.test(pattern)
}

/**
 * 判定 ancestor 是否为 descendant 的祖先或二者相同(按路径段比较,非裸字符串前缀)。
 *
 * 用 `ancestor + '/'` 作为前缀边界,避免 `src/foo` 误判为 `src/foo-bar` 的祖先
 * (二者实为同级)。ancestor === descendant 视为命中(完全相同的路径显然在作用域内)。
 */
function isAncestorOrEqual(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true
  return descendant.startsWith(`${ancestor}/`)
}

/**
 * 需转义的正则元字符集合(路径中合法但正则有特殊语义的字符)。
 *
 * 用 Set 表达便于 O(1) 判定;构造时传入字符串,Set 按字符迭代入集。`\\` 在字符串字面量中
 * 表示单个反斜杠,故集合含路径中可能出现的反斜杠(规范化后为正斜杠,转义防御性保留)。
 */
const REGEX_META = new Set<string>('.+^${}()|[]\\')

/**
 * glob 模式 → 正则(`*`→`[^/]*` 单层、`**`→`.*` 跨层、`?`→`[^/]`),锚定整条路径。
 *
 * 其余正则元字符转义,避免 `.``+` 等路径合法字符被当作正则元字符。`**` 贪婪跨目录,
 * 匹配任意层路径段(含空),覆盖 src 任意层目录常见模式。
 */
function globToRegex(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    // charAt 返回 string(noUncheckedIndexedAccess 下 [i] 为 string | undefined,charAt 避免)。
    const c = glob.charAt(i)
    if (c === '*') {
      // `**` → `.*`(跨层);单 `*` → `[^/]*`(单层,不含路径分隔符)。
      if (glob[i + 1] === '*') {
        re += '.*'
        i += 1 // 跳过第二个 `*`(for 循环再 i++ 跳到下一字符)
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if (REGEX_META.has(c)) {
      // 正则元字符转义(路径中合法的 . + 等需字面匹配)。
      re += `\\${c}`
    } else {
      re += c
    }
  }
  return new RegExp(`^${re}$`)
}

/**
 * 判定单个文件是否命中单个作用域模式。
 *
 * 含 glob → 正则匹配整条路径;否则 → 祖先/相同(目录覆盖后代、文件精确匹配)。
 */
function matchOne(file: string, pattern: string): boolean {
  if (containsGlob(pattern)) return globToRegex(pattern).test(file)
  return isAncestorOrEqual(pattern, file)
}

/**
 * 在模式集合中找出首个命中 file 的模式,返回该模式;无命中返回 undefined。
 *
 * 返回匹配模式(而非布尔)供违规记录标注 matchedPattern,便于人工定位是哪条声明命中。
 */
function matchAny(file: string, patterns: readonly string[]): string | undefined {
  for (const p of patterns) {
    if (matchOne(file, p)) return p
  }
  return undefined
}

/* ============================================================ *
 * 路径审计主函数
 * ============================================================ */

/**
 * 审计工作区实际变更是否全部落在 allowed 作用域内、且未命中 forbidden(FR-039 / §11)。
 *
 * 逐条变更文件判定(forbidden 优先):
 *   1. 命中任一 forbidden → forbidden 违规(deny 优先,即使同时落在 allowed 内)。
 *   2. 否则未命中任一 allowed → out-of-scope 违规(越界改动)。
 *   3. 命中 allowed 且未命中 forbidden → 合规,不计违规。
 *
 * 空变更清单 → ok=true(无改动自然不越界);空 allowed + 有变更 → 全部 out-of-scope
 * (任务声明零写入作用域时,任何改动都越界,§8 不静默放行)。
 *
 * @returns PathAuditOutcome 携带 ok 与结构化 violations(供映射 blocked + needs-human)。
 */
export function auditPaths(input: PathAuditInput): PathAuditOutcome {
  const allowed = input.allowedPaths.map(normalizePath).filter((p) => p.length > 0)
  const forbidden = input.forbiddenPaths.map(normalizePath).filter((p) => p.length > 0)

  const violations: PathViolation[] = []
  for (const rawFile of input.changedFiles) {
    const file = normalizePath(rawFile)
    // 规范化为空的路径视为数据噪声,跳过(不静默计数也不静默放行——无法判定的路径不参与审计)。
    if (file.length === 0) continue

    // forbidden 优先:命中即违规,即使同时落在 allowed 内(§11 验收)。
    const fb = matchAny(file, forbidden)
    if (fb !== undefined) {
      violations.push({ path: file, kind: 'forbidden', matchedPattern: fb })
      continue
    }

    // 未命中 forbidden 时,必须落在 allowed 内;否则越界。
    const al = matchAny(file, allowed)
    if (al === undefined) {
      violations.push({ path: file, kind: 'out-of-scope', matchedPattern: '' })
    }
  }

  return { ok: violations.length === 0, violations }
}
