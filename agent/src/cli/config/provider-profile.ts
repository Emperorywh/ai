/**
 * Provider Profile 配置读取 + SDK env 组装（TASK-031）。
 *
 * 职责（见 docs/tasks/TASK-031 / docs/SPEC_claude-sdk-integration.md §6）：
 *  - 定义 Provider Profile 结构（`provider` + `profiles[provider]`），zod 最小 schema 校验。
 *  - 读 `.caw/config.json`（`caw init` 产物）→ 解析为 `ProfileConfig`。
 *  - 组装 SDK `env`：按 §6 公式展开 `...process.env` + 注入 token + 三档模型映射 + extraEnv。
 *
 * 不做的事（§7）：不 import sdk-client（env 组装是纯逻辑）、不调 SDK、不实现 invocation/reviewer、
 * 不做 CLI `--provider` 的 commander 解析（归 TASK-034/035）、不做 deepseek profile（P1）。
 *
 * token 只从 `authTokenEnv` 指定的环境变量读，**不落配置文件明文**（§7）。
 */

import { readFileSync } from 'node:fs'
import { z } from 'zod'

/* ------------------------------------------------------------------ *
 * Schema（zod 单一来源 + z.infer 派生类型）
 * ------------------------------------------------------------------ */

/**
 * 三档模型映射：Claude Code 内部按任务复杂度自动选档（haiku/sonnet/opus），
 * 三档必须全部映射到 provider 实际存在的模型，缺档会使内部调用失败（R-PROVIDER）。
 */
export const ModelMappingSchema = z
  .object({
    haiku: z.string().min(1),
    sonnet: z.string().min(1),
    opus: z.string().min(1),
  })
  .strict()

/** 单个 provider profile：端点 + token 来源 + 档位映射 + 追加 env。 */
export const ProviderProfileSchema = z
  .object({
    /** null = 用 SDK 默认端点（官方 anthropic）；非空串 = 第三方 Anthropic 兼容端点。 */
    baseUrl: z.string().min(1).nullable(),
    /** 从该环境变量名读 token（不落配置明文）。 */
    authTokenEnv: z.string().min(1),
    /** 三档强制全映射。 */
    modelMapping: ModelMappingSchema,
    /** 追加到 SDK env 的键值对（如 GLM 的长超时 / 禁非必要流量）。 */
    extraEnv: z.record(z.string(), z.string()).default({}),
  })
  .strict()

/** 顶层配置：当前启用的 profile 名 + profiles 字典。 */
export const ProfileConfigSchema = z
  .object({
    /** 当前启用的 profile 名（可被 `--provider` 覆盖，见 resolveProfile）。 */
    provider: z.string().min(1),
    profiles: z.record(z.string(), ProviderProfileSchema),
  })
  .strict()

export type ModelMapping = z.infer<typeof ModelMappingSchema>
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>
export type ProfileConfig = z.infer<typeof ProfileConfigSchema>

/* ------------------------------------------------------------------ *
 * 预置配置（caw init 产物 + 默认值单一来源，SPEC §6「caw init 预置」）
 * ------------------------------------------------------------------ */

/**
 * 预置 profile 配置——`caw init` 据此生成 `.caw/config.json`，也是默认值单一来源。
 * - anthropic：官方端点（baseUrl null）→ 注入 ANTHROPIC_API_KEY，无 ANTHROPIC_BASE_URL。
 * - glm：智谱 Anthropic 兼容端点 → 注入 ANTHROPIC_AUTH_TOKEN + BASE_URL + 长超时 / 禁非必要流量。
 * deepseek 同理，P1 在 init 交互式添加（§6 / §16，本任务不做）。
 */
export const DEFAULT_PROFILE_CONFIG: ProfileConfig = {
  provider: 'anthropic',
  profiles: {
    anthropic: {
      baseUrl: null,
      authTokenEnv: 'ANTHROPIC_API_KEY',
      modelMapping: {
        haiku: 'claude-haiku-4-5',
        sonnet: 'claude-sonnet-5',
        opus: 'claude-opus-4-8',
      },
      extraEnv: {},
    },
    glm: {
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      authTokenEnv: 'ZHIPU_API_KEY',
      modelMapping: {
        haiku: 'glm-4.7',
        sonnet: 'glm-5.2',
        opus: 'glm-5.2',
      },
      extraEnv: {
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        // 第三方端点长超时（传输层，非 F4 执行上限，见 SPEC §4.5 / §6）
        API_TIMEOUT_MS: '3000000',
      },
    },
  },
}

/** 默认配置文件路径（相对项目根），与 `caw init` 产物一致。 */
export const DEFAULT_CONFIG_PATH = '.caw/config.json'

/* ------------------------------------------------------------------ *
 * 错误类型（显式不静默，AGENTS §3）
 * ------------------------------------------------------------------ */

/** Provider Profile 模块错误基类。 */
export class ProviderProfileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderProfileError'
  }
}

/** 配置文件非法：JSON 解析失败 / schema 校验失败（如三档缺映射）/ 启用 profile 不存在。 */
export class ProviderConfigError extends ProviderProfileError {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderConfigError'
  }
}

/** profile 的 token 环境变量未设置（启动前检测，SPEC §6「key 缺失」）。 */
export class ProviderTokenMissingError extends ProviderProfileError {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderTokenMissingError'
  }
}

/* ------------------------------------------------------------------ *
 * 读取与解析
 * ------------------------------------------------------------------ */

/**
 * 把 `.caw/config.json` 文本解析为 `ProfileConfig`（JSON.parse + zod 校验）。
 *
 * 纯函数（无文件 I/O）：测试主力入口，覆盖合法 / 三档缺映射 / 非法 JSON 等正反例。
 * JSON 语法错或 schema 校验失败均抛 `ProviderConfigError`（显式不静默）。
 */
export function parseProfileConfig(raw: string): ProfileConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new ProviderConfigError(
      `配置文件不是合法 JSON：${e instanceof Error ? e.message : String(e)}`,
    )
  }
  const result = ProfileConfigSchema.safeParse(parsed)
  if (!result.success) {
    throw new ProviderConfigError(`配置文件校验失败：${result.error.message}`)
  }
  return result.data
}

/**
 * 从 `configPath` 读配置文件并解析（I/O 薄包装，组合 `parseProfileConfig`）。
 *
 * 文件不存在 / 读取失败让底层错误冒泡（上层 CLI composition root 决定提示语）；
 * 内容非法抛 `ProviderConfigError`。
 */
export function readProfileConfig(configPath: string): ProfileConfig {
  const raw = readFileSync(configPath, 'utf8')
  return parseProfileConfig(raw)
}

/* ------------------------------------------------------------------ *
 * Profile 解析与 env 组装
 * ------------------------------------------------------------------ */

/** resolveProfile 返回的启用 profile 解析结果。 */
export interface ResolvedProfile {
  /** 实际启用的 profile 名（override 优先，否则 config.provider）。 */
  readonly name: string
  readonly profile: ProviderProfile
}

/**
 * 解析启用的 profile：`providerOverride` 优先（来自 034/035 的 `--provider`），否则用 `config.provider`。
 *
 * 启用的 profile 名在 `profiles` 中不存在时抛 `ProviderConfigError`（不静默）。
 * 本函数只做「选用哪个 profile」的纯逻辑，不做 commander 解析（§7）。
 */
export function resolveProfile(
  config: ProfileConfig,
  providerOverride?: string,
): ResolvedProfile {
  const name = providerOverride ?? config.provider
  const profile = config.profiles[name]
  if (!profile) {
    throw new ProviderConfigError(
      `启用的 profile「${name}」不在配置 profiles 中（可用：${Object.keys(config.profiles).join(', ')}）`,
    )
  }
  return { name, profile }
}

/**
 * 判定 token 注入键（R-PROVIDER）：`baseUrl` 为 null → 官方端点注入 `ANTHROPIC_API_KEY`；
 * `baseUrl` 非空 → 第三方兼容端点注入 `ANTHROPIC_AUTH_TOKEN`（bearer）。
 *
 * 官方端点用默认 baseUrl（null），第三方必然指向兼容端点（非空），故 baseUrl 是否存在
 * 与官方/第三方天然对应（SPEC §6 ⚠ 注释：两键不同）。
 */
function tokenEnvKey(profile: ProviderProfile): 'ANTHROPIC_API_KEY' | 'ANTHROPIC_AUTH_TOKEN' {
  return profile.baseUrl == null ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN'
}

/**
 * 把 `NodeJS.ProcessEnv` 规约为 `Record<string, string>`——剔除值为 undefined 的键。
 *
 * `process.env` 类型标注含 undefined（访问不存在的 key 时），但运行时自有属性值都是 string；
 * 展开进 SDK `env: Dict<string>` 前剔除 undefined，保证类型与运行时一致。
 */
function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      out[key] = value
    }
  }
  return out
}

/** buildProviderEnv 选项。 */
export interface BuildProviderEnvOptions {
  /**
   * 读取 token 与展开 `...process.env` 的环境来源，默认 `process.env`。
   * 测试注入 fake env 以隔离真实环境（断言注入键 / 缺失 / 展开）。
   */
  readonly env?: NodeJS.ProcessEnv
}

/**
 * 按 SPEC §6 公式组装 SDK `env`：
 * `{ ...process.env, [tokenKey]: token, ...(baseUrl? {ANTHROPIC_BASE_URL}:{}),
 *    ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL, ...extraEnv }`。
 *
 * - 必须展开 `...process.env`（SDK 传 env 整体替换子进程环境，§12）。
 * - token 从 `profile.authTokenEnv` 指定的环境变量读；缺失抛 `ProviderTokenMissingError`（§6 key 缺失）。
 * - 三档映射写入 `ANTHROPIC_DEFAULT_*_MODEL`（Claude Code 内部按复杂度选档）。
 * - extraEnv 最后展开（可覆盖前面的键）。
 *
 * 纯逻辑，不触达模型——返回的 env 由调用方（034/035）传给 invocation/reviewer。
 */
export function buildProviderEnv(
  profile: ProviderProfile,
  options: BuildProviderEnvOptions = {},
): Record<string, string> {
  const env = options.env ?? process.env

  const token = env[profile.authTokenEnv]
  if (token === undefined || token === '') {
    throw new ProviderTokenMissingError(
      `profile 的 token 环境变量「${profile.authTokenEnv}」未设置——请设置该变量，或显式指定 --executor dry-run 兜底`,
    )
  }

  const tokenKey = tokenEnvKey(profile)

  return {
    ...stringEnv(env),
    [tokenKey]: token,
    ...(profile.baseUrl != null ? { ANTHROPIC_BASE_URL: profile.baseUrl } : {}),
    ANTHROPIC_DEFAULT_HAIKU_MODEL: profile.modelMapping.haiku,
    ANTHROPIC_DEFAULT_SONNET_MODEL: profile.modelMapping.sonnet,
    ANTHROPIC_DEFAULT_OPUS_MODEL: profile.modelMapping.opus,
    ...profile.extraEnv,
  }
}

/** composeProviderEnv 选项。 */
export interface ComposeProviderEnvOptions {
  /** 覆盖启用的 profile 名（来自 034/035 的 `--provider`）。 */
  readonly providerOverride?: string
  /** 环境来源，默认 `process.env`（透传给 buildProviderEnv）。 */
  readonly env?: NodeJS.ProcessEnv
}

/**
 * 便利入口：解析启用 profile + 组装 SDK env 一步到位（供 034/035 CLI composition root 调用）。
 *
 * 等价于 `buildProviderEnv(resolveProfile(config, override).profile, { env })`。
 */
export function composeProviderEnv(
  config: ProfileConfig,
  options: ComposeProviderEnvOptions = {},
): Record<string, string> {
  const { profile } = resolveProfile(config, options.providerOverride)
  return buildProviderEnv(profile, { env: options.env })
}
