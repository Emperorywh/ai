import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_PROFILE_CONFIG,
  ProfileConfigSchema,
  ProviderConfigError,
  ProviderTokenMissingError,
  buildProviderEnv,
  composeProviderEnv,
  parseProfileConfig,
  readProfileConfig,
  resolveProfile,
  type ProfileConfig,
} from '../../../src/cli/config/provider-profile.js'
import { DOC_FILES, scaffoldProject } from '../../../src/cli/commands/init.js'

/* ------------------------------------------------------------------ *
 * 测试用最小 profile 工厂——避免每个用例重复字面量（AGENTS §3 不复制粘贴）。
 * ------------------------------------------------------------------ */

function makeProfile(overrides: {
  baseUrl?: string | null
  authTokenEnv?: string
  modelMapping?: { haiku?: string; sonnet?: string; opus?: string }
  extraEnv?: Record<string, string>
} = {}): ProfileConfig['profiles'][string] {
  return {
    baseUrl: overrides.baseUrl !== undefined ? overrides.baseUrl : null,
    authTokenEnv: overrides.authTokenEnv ?? 'TEST_TOKEN',
    modelMapping: {
      haiku: overrides.modelMapping?.haiku ?? 'm-haiku',
      sonnet: overrides.modelMapping?.sonnet ?? 'm-sonnet',
      opus: overrides.modelMapping?.opus ?? 'm-opus',
    },
    extraEnv: overrides.extraEnv ?? {},
  }
}

describe('provider-profile — DEFAULT_PROFILE_CONFIG 合法性', () => {
  it('预置配置过 ProfileConfigSchema 校验（结构 + 三档全映射）', () => {
    expect(() => ProfileConfigSchema.parse(DEFAULT_PROFILE_CONFIG)).not.toThrow()
  })

  it('预置 anthropic + glm 两个 profile（SPEC §6「caw init 预置」）', () => {
    expect(Object.keys(DEFAULT_PROFILE_CONFIG.profiles).sort()).toEqual(['anthropic', 'glm'])
  })

  it('默认启用 anthropic', () => {
    expect(DEFAULT_PROFILE_CONFIG.provider).toBe('anthropic')
  })
})

describe('provider-profile — parseProfileConfig（schema 校验）', () => {
  it('合法 JSON 解析成功', () => {
    const raw = JSON.stringify(DEFAULT_PROFILE_CONFIG)
    expect(parseProfileConfig(raw)).toEqual(DEFAULT_PROFILE_CONFIG)
  })

  it('baseUrl 为 null（官方端点）合法', () => {
    const config = parseProfileConfig(
      JSON.stringify({
        provider: 'p',
        profiles: { p: { baseUrl: null, authTokenEnv: 'T', modelMapping: { haiku: 'a', sonnet: 'b', opus: 'c' } } },
      }),
    )
    expect(config.profiles.p!.baseUrl).toBeNull()
  })

  it('三档缺 sonnet 报错（R-PROVIDER 强制全映射）', () => {
    const raw = JSON.stringify({
      provider: 'p',
      profiles: { p: { baseUrl: null, authTokenEnv: 'T', modelMapping: { haiku: 'a', opus: 'c' } } },
    })
    expect(() => parseProfileConfig(raw)).toThrow(ProviderConfigError)
  })

  it('三档缺 haiku 报错', () => {
    const raw = JSON.stringify({
      provider: 'p',
      profiles: { p: { baseUrl: null, authTokenEnv: 'T', modelMapping: { sonnet: 'b', opus: 'c' } } },
    })
    expect(() => parseProfileConfig(raw)).toThrow(ProviderConfigError)
  })

  it('档位映射值为空串报错（min(1)）', () => {
    const raw = JSON.stringify({
      provider: 'p',
      profiles: { p: { baseUrl: null, authTokenEnv: 'T', modelMapping: { haiku: '', sonnet: 'b', opus: 'c' } } },
    })
    expect(() => parseProfileConfig(raw)).toThrow(ProviderConfigError)
  })

  it('缺 provider 字段报错', () => {
    const raw = JSON.stringify({ profiles: {} })
    expect(() => parseProfileConfig(raw)).toThrow(ProviderConfigError)
  })

  it('profile 缺 authTokenEnv 报错', () => {
    const raw = JSON.stringify({
      provider: 'p',
      profiles: { p: { baseUrl: null, modelMapping: { haiku: 'a', sonnet: 'b', opus: 'c' } } },
    })
    expect(() => parseProfileConfig(raw)).toThrow(ProviderConfigError)
  })

  it('非法 JSON 报错（ProviderConfigError，非原始 SyntaxError）', () => {
    expect(() => parseProfileConfig('{ not json')).toThrow(ProviderConfigError)
  })
})

describe('provider-profile — resolveProfile', () => {
  it('无 override 用 config.provider', () => {
    const resolved = resolveProfile(DEFAULT_PROFILE_CONFIG)
    expect(resolved.name).toBe('anthropic')
    expect(resolved.profile.authTokenEnv).toBe('ANTHROPIC_API_KEY')
  })

  it('override 优先（选 glm）', () => {
    const resolved = resolveProfile(DEFAULT_PROFILE_CONFIG, 'glm')
    expect(resolved.name).toBe('glm')
    expect(resolved.profile.baseUrl).toBe('https://open.bigmodel.cn/api/anthropic')
  })

  it('override 指向不存在的 profile 抛 ProviderConfigError', () => {
    expect(() => resolveProfile(DEFAULT_PROFILE_CONFIG, 'nonexistent')).toThrow(ProviderConfigError)
  })

  it('config.provider 指向不存在的 profile 抛错', () => {
    const config: ProfileConfig = { provider: 'missing', profiles: { anthropic: DEFAULT_PROFILE_CONFIG.profiles.anthropic! } }
    expect(() => resolveProfile(config)).toThrow(ProviderConfigError)
  })
})

describe('provider-profile — buildProviderEnv [anthropic 官方端点]', () => {
  // 官方 profile：baseUrl null → 注入 ANTHROPIC_API_KEY、无 ANTHROPIC_BASE_URL（验收 1）
  it('注入 ANTHROPIC_API_KEY，无 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN', () => {
    const env = buildProviderEnv(DEFAULT_PROFILE_CONFIG.profiles.anthropic!, {
      env: { ANTHROPIC_API_KEY: 'sk-official' },
    })
    expect(env.ANTHROPIC_API_KEY).toBe('sk-official')
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  })

  it('写入三档 ANTHROPIC_DEFAULT_*_MODEL', () => {
    const env = buildProviderEnv(DEFAULT_PROFILE_CONFIG.profiles.anthropic!, {
      env: { ANTHROPIC_API_KEY: 'sk' },
    })
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('claude-haiku-4-5')
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-5')
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-opus-4-8')
  })
})

describe('provider-profile — buildProviderEnv [glm 第三方兼容端点]', () => {
  // 第三方 profile：baseUrl 非空 → 注入 ANTHROPIC_AUTH_TOKEN + BASE_URL + 三档 + 两项 extraEnv（验收 2）
  it('注入 ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL，无 ANTHROPIC_API_KEY', () => {
    const env = buildProviderEnv(DEFAULT_PROFILE_CONFIG.profiles.glm!, {
      env: { ZHIPU_API_KEY: 'glm-secret' },
    })
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('glm-secret')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://open.bigmodel.cn/api/anthropic')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('三档映射为 GLM 模型', () => {
    const env = buildProviderEnv(DEFAULT_PROFILE_CONFIG.profiles.glm!, {
      env: { ZHIPU_API_KEY: 'glm-secret' },
    })
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('glm-4.7')
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('glm-5.2')
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('glm-5.2')
  })

  it('extraEnv 追加 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC / API_TIMEOUT_MS', () => {
    const env = buildProviderEnv(DEFAULT_PROFILE_CONFIG.profiles.glm!, {
      env: { ZHIPU_API_KEY: 'glm-secret' },
    })
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1')
    expect(env.API_TIMEOUT_MS).toBe('3000000')
  })
})

describe('provider-profile — buildProviderEnv [env 展开与覆盖]', () => {
  it('展开传入的 env 源（验收 ...process.env 展开）', () => {
    const env = buildProviderEnv(makeProfile({ authTokenEnv: 'TEST_TOKEN' }), {
      env: { PATH: '/usr/bin', HOME: '/root', CUSTOM_VAR: 'kept', TEST_TOKEN: 't' },
    })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/root')
    expect(env.CUSTOM_VAR).toBe('kept')
  })

  it('剔除值为 undefined 的环境变量（stringEnv 规范化）', () => {
    const env = buildProviderEnv(makeProfile({ authTokenEnv: 'TEST_TOKEN' }), {
      env: { KEEP: 'v', DROP: undefined, TEST_TOKEN: 't' },
    })
    expect(env.KEEP).toBe('v')
    expect(env.DROP).toBeUndefined()
  })

  it('extraEnv 最后展开，可覆盖前面的键（后写者覆盖，SPEC §6 公式顺序）', () => {
    const env = buildProviderEnv(
      makeProfile({ authTokenEnv: 'TEST_TOKEN', extraEnv: { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'override-haiku' } }),
      { env: { TEST_TOKEN: 't' } },
    )
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('override-haiku')
  })
})

describe('provider-profile — buildProviderEnv [token 缺失]', () => {
  it('token 环境变量未设置抛 ProviderTokenMissingError（§6 key 缺失，不静默）', () => {
    expect(() =>
      buildProviderEnv(DEFAULT_PROFILE_CONFIG.profiles.anthropic!, { env: { OTHER: 'x' } }),
    ).toThrow(ProviderTokenMissingError)
  })

  it('token 为空串同样视为缺失', () => {
    expect(() =>
      buildProviderEnv(DEFAULT_PROFILE_CONFIG.profiles.anthropic!, { env: { ANTHROPIC_API_KEY: '' } }),
    ).toThrow(ProviderTokenMissingError)
  })
})

describe('provider-profile — composeProviderEnv（便利入口）', () => {
  it('无 override 走默认 profile（anthropic）', () => {
    const env = composeProviderEnv(DEFAULT_PROFILE_CONFIG, {
      env: { ANTHROPIC_API_KEY: 'sk' },
    })
    expect(env.ANTHROPIC_API_KEY).toBe('sk')
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
  })

  it('providerOverride 切到 glm（--provider glm 链路，034/035 用）', () => {
    const env = composeProviderEnv(DEFAULT_PROFILE_CONFIG, {
      providerOverride: 'glm',
      env: { ZHIPU_API_KEY: 'glm-secret' },
    })
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('glm-secret')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://open.bigmodel.cn/api/anthropic')
  })

  it('override 不存在抛 ProviderConfigError', () => {
    expect(() =>
      composeProviderEnv(DEFAULT_PROFILE_CONFIG, { providerOverride: 'nope', env: {} }),
    ).toThrow(ProviderConfigError)
  })
})

describe('provider-profile — readProfileConfig（文件 I/O）', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'caw-profile-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('从文件读取并解析合法配置', () => {
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify(DEFAULT_PROFILE_CONFIG), 'utf8')
    const config = readProfileConfig(configPath)
    expect(config.provider).toBe('anthropic')
    expect(Object.keys(config.profiles).sort()).toEqual(['anthropic', 'glm'])
  })

  it('损坏内容抛 ProviderConfigError', () => {
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, '{ broken', 'utf8')
    expect(() => readProfileConfig(configPath)).toThrow(ProviderConfigError)
  })
})

describe('provider-profile — init 产物含两个 profile 模板（验收 5）', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'caw-init-profile-'))
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('DOC_FILES 含 .caw/config.json（DEFAULT_CONFIG_PATH）', () => {
    expect(DOC_FILES.map((f) => f.path)).toContain(DEFAULT_CONFIG_PATH)
  })

  it('scaffoldProject 生成 .caw/config.json，解析后含 anthropic + glm', () => {
    scaffoldProject(projectDir)
    const configPath = join(projectDir, DEFAULT_CONFIG_PATH)
    const raw = readFileSync(configPath, 'utf8')
    const config = parseProfileConfig(raw)
    expect(Object.keys(config.profiles).sort()).toEqual(['anthropic', 'glm'])
    // 模板内 token 只含环境变量名，不含明文
    expect(config.profiles.anthropic!.authTokenEnv).toBe('ANTHROPIC_API_KEY')
    expect(config.profiles.glm!.authTokenEnv).toBe('ZHIPU_API_KEY')
    // glm 预置 extraEnv（长超时 / 禁非必要流量）
    expect(config.profiles.glm!.extraEnv.API_TIMEOUT_MS).toBe('3000000')
  })
})
