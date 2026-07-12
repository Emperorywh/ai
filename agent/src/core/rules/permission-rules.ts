/**
 * Core 权限解析规则（Readme.md §16 权限模型）。
 *
 * 以纯函数表达执行期授权的三条核心规则：
 *   - resolvePathScope：检测 allowed_paths 与 forbidden_paths 重叠，重叠即 deny 优先、
 *     拒绝启动（§16），由 infrastructure 层在 Task Executor 启动前调用。
 *   - validateCommandPermissions：校验验证命令声明的 requires_permissions 是否被任务
 *     permissions 覆盖；未覆盖即拒绝执行（§16）。
 *   - scanCommandHeuristics：命令字符串启发式扫描，只产生 warning 提示「该命令看起来
 *     需要额外权限」，不参与授权（§16：最终授权只以 permissions 与 requires_permissions
 *     的交集为准）。
 *
 * 设计约束（任务 §8 / §12 风险点）：
 *   - 纯函数。复用 enums 的 Permission 类型，不引入 zod。
 *   - 验证 allowlist 内命令的执行授权自动获得（仅限该命令行），无需 run_commands，
 *     故 validateCommandPermissions 只校验 requires_permissions，不检查 run_commands。
 *   - 启发式扫描结果绝不参与授权——能力只能来自显式 permissions / requires_permissions。
 *
 * 硬约束（AGENTS.md §2 / docs/ARCHITECTURE.md §3）：零反向依赖，仅依赖同层 enums 类型。
 *
 * 权威来源：根目录 Readme.md §16（权限模型）。
 */
import type { Permission } from '../enums.js'

/* ============================================================ *
 * 路径作用域冲突检测（deny 优先）
 * ============================================================ */

/**
 * 路径作用域检测结果。
 *
 *   - ok:true：allowed 与 forbidden 无重叠，可正常启动。
 *   - ok:false：存在重叠，deny 优先——返回 overlaps（重叠路径对）与 reason，
 *     由 infrastructure 层据此时告警并拒绝启动（§16），不静默取并集。
 */
export type PathScopeResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: string
      readonly overlaps: readonly PathOverlap[]
    }

/**
 * 一组相互重叠的 allowed / forbidden 路径对（已规范化）。
 */
export interface PathOverlap {
  readonly allowed: string
  readonly forbidden: string
}

/**
 * 规范化路径：去首尾空白、反斜杠统一为正斜杠、去尾部冗余斜杠。
 *
 * allowed_paths / forbidden_paths 在 frontmatter 中以正斜杠表达；规范化统一 Windows
 * 反斜杠与尾部斜杠差异，使后续比较基于一致的路径形态。
 */
function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
}

/**
 * 判定 ancestor 是否为 descendant 的祖先或二者相同（按路径段比较，非裸字符串前缀）。
 *
 * 用 `ancestor + '/'` 作为前缀边界，避免 `src/foo` 误判为 `src/foo-bar` 的祖先
 * （二者实为同级目录）。ancestor === descendant 视为重叠（完全相同的路径显然冲突）。
 */
function isAncestorOrEqual(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) {
    return true
  }
  return descendant.startsWith(`${ancestor}/`)
}

/**
 * 判定两条路径是否重叠（任一方为另一方的祖先或相同）。
 */
function pathsOverlap(a: string, b: string): boolean {
  return isAncestorOrEqual(a, b) || isAncestorOrEqual(b, a)
}

/**
 * 检测 allowed_paths 与 forbidden_paths 的重叠（§16 deny 优先）。
 *
 * 任一 allowed 路径与任一 forbidden 路径构成祖先 / 相同关系即视为重叠——重叠时
 * deny 优先，返回 ok:false 与全部重叠路径对，由调用方拒绝启动。空路径（规范化后为空）
 * 视为数据错误并跳过，不计入重叠。
 */
export function resolvePathScope(
  allowed: readonly string[],
  forbidden: readonly string[],
): PathScopeResult {
  const normAllowed = allowed.map(normalizePath).filter((p) => p.length > 0)
  const normForbidden = forbidden
    .map(normalizePath)
    .filter((p) => p.length > 0)

  const overlaps: PathOverlap[] = []
  const seen = new Set<string>()
  for (const a of normAllowed) {
    for (const f of normForbidden) {
      if (!pathsOverlap(a, f)) continue
      const key = `${a} :: ${f}`
      if (seen.has(key)) continue
      seen.add(key)
      overlaps.push({ allowed: a, forbidden: f })
    }
  }

  if (overlaps.length === 0) {
    return { ok: true }
  }
  return {
    ok: false,
    reason:
      'allowed_paths 与 forbidden_paths 重叠：deny 优先，拒绝启动（Readme.md §16）',
    overlaps,
  }
}

/* ============================================================ *
 * 命令能力校验（requires_permissions ⊆ permissions）
 * ============================================================ */

/**
 * validateCommandPermissions 的命令输入——结构类型，兼容 VerificationCommand
 * （src/core/rules/verification-rules.ts），无需显式转换。
 */
export interface CommandPermissionSpec {
  readonly command: string
  readonly requires_permissions: readonly Permission[]
}

/**
 * 命令能力校验结果。
 *   - ok:true：命令声明的 requires_permissions 全部被任务 permissions 覆盖，可执行。
 *   - ok:false：存在未覆盖能力，返回 missing 与 reason，由调用方拒绝执行该命令。
 */
export type CommandPermissionsResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: string
      readonly missing: readonly Permission[]
    }

/**
 * 校验命令声明的 requires_permissions 是否被任务 permissions 覆盖（§16）。
 *
 * 验证 allowlist 内命令的执行授权自动获得（仅限该命令行），故本函数只校验
 * requires_permissions ⊆ permissions，不检查 run_commands。任一 requires_permissions
 * 缺失即拒绝执行（不静默放权），返回 missing 清单。
 *
 * command 参数为结构类型 CommandPermissionSpec，可直接传入 computeVerificationAllowlist
 * 产出的 VerificationCommand。
 */
export function validateCommandPermissions(
  command: CommandPermissionSpec,
  taskPermissions: readonly Permission[],
): CommandPermissionsResult {
  const granted = new Set(taskPermissions)
  const missing = command.requires_permissions.filter((p) => !granted.has(p))
  if (missing.length === 0) {
    return { ok: true }
  }
  return {
    ok: false,
    reason: `命令 "${command.command}" 声明的 requires_permissions 未被任务 permissions 覆盖：${missing.join(', ')}（Readme.md §16）`,
    missing,
  }
}

/* ============================================================ *
 * allowlist 批量权限校验（TASK-039 / FR-011.3）——汇总权限不足命令
 * ============================================================ */

/**
 * 权限不足的命令清单项（validateAllowlistPermissions 返回）。
 */
export interface DeniedCommand {
  /** 权限不足的命令行。 */
  readonly command: string
  /** 该命令声明但任务 permissions 未覆盖的能力。 */
  readonly missing: readonly Permission[]
}

/**
 * allowlist 批量权限校验结果。
 *   - ok:true：allowlist 所有命令的 requires_permissions 均被任务 permissions 覆盖，可全部执行。
 *   - ok:false：返回 denied（权限不足命令清单），供 VerifyTaskUseCase 映射为 blocked / needs-human
 *     （§8「权限缺失返回结构化结果，不静默跳过」）。
 */
export type AllowlistPermissionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly denied: readonly DeniedCommand[] }

/**
 * 对 allowlist 批量校验 requires_permissions 是否被任务 permissions 覆盖（FR-011.3 / §8）。
 *
 * 逐条复用 validateCommandPermissions 语义：收集所有 requires_permissions 未被覆盖的命令与其缺失能力。返回 ok:false 时，
 * 调用方（VerifyTaskUseCase）不得调 Runner（§11「requires_permissions 缺失时 Runner 不被调用」），直接产
 * blocked + needs-human 结构化结果，不静默跳过（§8）。
 *
 * @param allowlist computeVerificationAllowlist 产出的最终验证命令清单（结构兼容 VerificationCommand）。
 * @param taskPermissions 任务 frontmatter 声明的能力。
 */
export function validateAllowlistPermissions(
  allowlist: readonly CommandPermissionSpec[],
  taskPermissions: readonly Permission[],
): AllowlistPermissionResult {
  const granted = new Set(taskPermissions)
  const denied: DeniedCommand[] = []
  for (const cmd of allowlist) {
    const missing = cmd.requires_permissions.filter((p) => !granted.has(p))
    if (missing.length > 0) {
      denied.push({ command: cmd.command, missing })
    }
  }
  if (denied.length === 0) return { ok: true }
  return { ok: false, denied }
}

/* ============================================================ *
 * 命令字符串启发式扫描（仅 warning，不授权）
 * ============================================================ */

/**
 * 启发式扫描产出的告警——仅提示「该命令看起来需要额外权限」，不参与授权。
 */
export interface PermissionHeuristicWarning {
  readonly command: string
  readonly suggested_permissions: readonly Permission[]
  readonly reason: string
}

/**
 * 单条启发式规则：匹配模式 + 建议能力 + 命中说明。
 */
interface HeuristicRule {
  readonly pattern: RegExp
  readonly permissions: readonly Permission[]
  readonly reason: string
}

/**
 * 命令字符串 → 可能需要的能力（启发式，§16 明确仅供告警）。
 *
 * 匹配以常见命令起始符（行首或命令链分隔符 & ; |）为词界，避免在命令链中漏判。
 * 这些规则只产生告警，绝不授予权限——最终授权以 permissions 与 requires_permissions
 * 的交集为准（validateCommandPermissions）。
 */
const HEURISTIC_RULES: readonly HeuristicRule[] = [
  {
    pattern: /(^|[\s&;|])(npm|pnpm|yarn)\s+(install|ci|add|remove|upgrade)\b/,
    permissions: ['install_dependencies'],
    reason: '命令看起来在安装 / 升级依赖',
  },
  {
    pattern: /(^|[\s&;|])(curl|wget|ping|scp|ftp|nc)\b/,
    permissions: ['network_access'],
    reason: '命令看起来需要联网访问',
  },
  {
    pattern: /(^|[\s&;|])(npm\s+start|npm\s+run\s+dev|vite|next\s+dev|nodemon)\b/,
    permissions: ['start_dev_server'],
    reason: '命令看起来启动长期运行的开发服务',
  },
  {
    pattern: /(^|[\s&;|])(xdg-open|sensible-browser)\b/,
    permissions: ['open_browser'],
    reason: '命令看起来打开浏览器',
  },
  {
    pattern: /(^|[\s&;|])(rm|rmdir|del|rimraf|unlink)\b/,
    permissions: ['delete_files'],
    reason: '命令看起来删除文件',
  },
  {
    pattern: /(package\.json|tsconfig\.json|\.eslintrc|\.prettierrc|settings\.json)/,
    permissions: ['modify_config'],
    reason: '命令看起来修改配置文件',
  },
]

/**
 * 对命令字符串做启发式扫描，返回可能需要的额外能力告警（§16）。
 *
 * 每条命中的启发式规则产生一条 warning；warning 仅作提示，调用方不得据此授予或拒绝
 * 权限——授权判定只走 validateCommandPermissions（permissions × requires_permissions）。
 */
export function scanCommandHeuristics(
  command: string,
): PermissionHeuristicWarning[] {
  const warnings: PermissionHeuristicWarning[] = []
  for (const rule of HEURISTIC_RULES) {
    if (rule.pattern.test(command)) {
      warnings.push({
        command,
        suggested_permissions: rule.permissions,
        reason: rule.reason,
      })
    }
  }
  return warnings
}
