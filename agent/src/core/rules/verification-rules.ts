/**
 * Core 验证 allowlist 计算（Readme.md §16 验证命令来源与优先级 / §6.8 TESTING.md 声明）。
 *
 * 把项目级 docs/TESTING.md 的命令声明按任务 layer 裁剪后，与任务级 frontmatter
 * verification 取并集，产出最终执行的验证命令序列。每条命令携带显式 requires_permissions，
 * 供 permission-rules.ts 的 validateCommandPermissions 做能力校验。
 *
 * 设计约束（任务 §8）：
 *   - 纯函数。复用 enums 的 Layer / Permission 类型，不引入 zod（输入由上层以已校验的
 *     TESTING.md 声明 / 任务 frontmatter 字符串数组传入）。
 *   - 命令身份 = 命令行字符串；requires_permissions 是命令的结构化属性，仅在项目级
 *     TESTING.md 声明中给出（任务级 verification 是裸字符串，无元数据）。
 *   - layer 裁剪：layers 未声明 → 对所有 layer 生效；声明 → 仅命中 layer；
 *     显式空数组 [] → 不命中任何 layer（与「未声明=全 layer」语义区分）。
 *   - 任务级覆盖：同一命令两处声明时任务级优先——既保证该命令一定进入 allowlist
 *     （无视 layer 排除），又在合并结果中以 source='task' 标注归属；requires_permissions
 *     始终取自项目级声明，任务级裸字符串覆盖不抹除已声明能力（避免静默放权，§16）。
 *
 * 硬约束（AGENTS.md §2 / docs/ARCHITECTURE.md §3）：零反向依赖，仅依赖同层 enums 类型。
 *
 * 权威来源：根目录 Readme.md §16（验证命令来源与优先级）/ §6.8（TESTING.md 命令声明）。
 */
import type { Layer, Permission } from '../enums.js'

/* ============================================================ *
 * 命令声明与合并结果类型
 * ============================================================ */

/**
 * 项目级（docs/TESTING.md）单条验证命令声明。
 *
 * 对应 TESTING.md 中每条命令的 YAML 块（§6.8）：
 *   - command：命令行字符串，命令身份（去重键）。
 *   - layers：适用的 layer 枚举列表；undefined 表示对所有 layer 生效。注意显式空数组 []
 *     表示「不命中任何 layer」，与 undefined（全 layer）语义不同。
 *   - requires_permissions：除 run_commands 外需要的额外能力（§16）。未声明时取空数组——
 *     命令在 allowlist 内时执行授权自动获得，无需声明 run_commands。
 */
export interface TestingCommand {
  readonly command: string
  readonly layers?: readonly Layer[]
  readonly requires_permissions?: readonly Permission[]
}

/**
 * 合并后 allowlist 命令的来源标注。
 *   - 'project'：仅来自项目级 TESTING.md（经 layer 裁剪命中）。
 *   - 'task'：任务级 verification 引入（含同名命令的任务级覆盖）。
 */
export type VerificationCommandSource = 'project' | 'task'

/**
 * 合并后的验证命令（allowlist 最终条目）。
 *
 * command 是命令身份；source 标注该命令由项目级还是任务级引入（同名命令两处声明时
 * 为 'task'，体现任务级优先）；requires_permissions 恒为已解析的非空或空数组，始终取自
 * 项目级声明（任务级裸字符串无元数据，同名覆盖不抹除已声明能力，避免静默放权）。
 */
export interface VerificationCommand {
  readonly command: string
  readonly source: VerificationCommandSource
  readonly requires_permissions: readonly Permission[]
}

/**
 * computeVerificationAllowlist 的输入。
 */
export interface ComputeVerificationAllowlistInput {
  /** 当前任务的 layer（用于裁剪项目级命令）。 */
  readonly taskLayer: Layer
  /** 项目级 TESTING.md 的全部命令声明（裁剪前的全集）。 */
  readonly testingCommands: readonly TestingCommand[]
  /** 任务级 frontmatter verification（裸命令行字符串数组）。 */
  readonly taskVerification: readonly string[]
}

/* ============================================================ *
 * layer 裁剪
 * ============================================================ */

/**
 * 判定项目级命令是否对当前 layer 生效：layers 未声明 → 全 layer；声明 → 需含本 layer。
 *
 * 显式空数组 [] 视为「声明但无适用 layer」，返回 false（与 undefined 的「全 layer」区分）。
 */
function commandAppliesToLayer(command: TestingCommand, layer: Layer): boolean {
  if (command.layers === undefined) {
    return true
  }
  return command.layers.includes(layer)
}

/* ============================================================ *
 * allowlist 计算（§16 并集 + 任务级覆盖）
 * ============================================================ */

/**
 * 计算任务实际执行的验证命令 allowlist（§16）。
 *
 * 步骤：
 *   1. 按任务 layer 裁剪项目级命令（layers 未声明 ∪ 含本 layer）。
 *   2. 与任务级 verification 取并集，按命令行去重。
 *   3. 同名命令两处声明 → 任务级优先（source 置 'task'，命令必入 allowlist，
 *      无视 layer 排除）；requires_permissions 取自项目级声明（保留已声明能力）。
 *
 * 输出顺序确定：先裁剪命中的项目级命令（TESTING.md 声明顺序），后任务级新增命令
 * （verification 顺序），便于测试断言与上层确定性执行。
 *
 * 任务级命令若匹配一条被 layer 排除的项目级声明，仍按命令身份取其 requires_permissions
 * （命令能力不随引入方改变），source 标 'task'（任务级引入）。
 */
export function computeVerificationAllowlist(
  input: ComputeVerificationAllowlistInput,
): VerificationCommand[] {
  const { taskLayer, testingCommands, taskVerification } = input

  // 项目级声明按命令行建索引（全集，未裁剪）——供任务级裸命令查询 requires_permissions。
  // TESTING.md 内重复声明视为数据错误，首现优先。
  const declByCommand = new Map<string, TestingCommand>()
  for (const cmd of testingCommands) {
    if (!declByCommand.has(cmd.command)) {
      declByCommand.set(cmd.command, cmd)
    }
  }

  // 合并结果（保留插入顺序）：命令行 -> VerificationCommand。
  const merged = new Map<string, VerificationCommand>()

  // 第一步：layer 裁剪命中的项目级命令（首现优先，TESTING.md 重复声明视为数据错误）。
  for (const cmd of testingCommands) {
    if (!commandAppliesToLayer(cmd, taskLayer)) continue
    if (merged.has(cmd.command)) continue
    merged.set(cmd.command, {
      command: cmd.command,
      source: 'project',
      requires_permissions: cmd.requires_permissions ?? [],
    })
  }

  // 第二步：任务级 verification 取并集，同名命令任务级优先。
  for (const commandLine of taskVerification) {
    const existing = merged.get(commandLine)
    if (existing === undefined) {
      // 任务级新增命令：若匹配某条项目级声明（含被 layer 排除的），取其 requires_permissions。
      const decl = declByCommand.get(commandLine)
      merged.set(commandLine, {
        command: commandLine,
        source: 'task',
        requires_permissions: decl?.requires_permissions ?? [],
      })
    } else {
      // 同名命令两处声明：任务级优先——source 置 'task'，requires_permissions 保持项目级声明。
      if (existing.source !== 'task') {
        merged.set(commandLine, { ...existing, source: 'task' })
      }
    }
  }

  return [...merged.values()]
}
