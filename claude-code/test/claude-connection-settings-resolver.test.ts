/*
 * Claude 用户设置投影测试同时验证模型事实、认证可用与权限隔离。
 * 测试注入内存设置加载器，不读取真实用户凭据，也不启动 Claude Code 子进程。
 */
import { describe, expect, it } from "vitest";
import {
  SdkClaudeConnectionSettingsResolver,
} from "../src/infrastructure/claude/claude-connection-settings-resolver.js";
import { SdkClaudeModelResolver } from "../src/infrastructure/claude/claude-model-resolver.js";
import {
  SdkClaudeUserSettingsSource,
  type ClaudeSettingsLoader,
} from "../src/infrastructure/claude/claude-user-settings-source.js";

describe("Claude 用户设置投影", () => {
  it("从 CC Switch 写入的 ANTHROPIC_MODEL 读取当前模型", async () => {
    const loadSettings: ClaudeSettingsLoader = async () => ({
      effective: {
        env: { ANTHROPIC_MODEL: " kimi-k3[1m] " },
      },
      provenance: {},
      sources: [],
    });
    const resolver = new SdkClaudeModelResolver(
      new SdkClaudeUserSettingsSource(loadSettings),
    );

    /*
     * CC Switch 的真实用户配置只有 env 映射，解析器必须去除外围空白并保留完整模型名。
     * 解析结果会被应用层持久化为 attempt.requestedModel，并用于 SDK 精确握手。
     */
    await expect(resolver.resolveModel("C:\\target-project"))
      .resolves.toBe("kimi-k3[1m]");
  });

  it("遵循 Claude Code 优先级让 ANTHROPIC_MODEL 覆盖 model", async () => {
    const loadSettings: ClaudeSettingsLoader = async () => ({
      effective: {
        model: "settings-model",
        env: { ANTHROPIC_MODEL: "environment-model" },
      },
      provenance: {},
      sources: [],
    });
    const resolver = new SdkClaudeModelResolver(
      new SdkClaudeUserSettingsSource(loadSettings),
    );

    /*
     * 环境模型与设置模型同时存在时必须保持 Claude Code 的确定性优先级。
     * Apex 传给 SDK 的显式模型由该结果生成，不能与终端中的 Claude 会话产生分歧。
     */
    await expect(resolver.resolveModel("C:\\target-project"))
      .resolves.toBe("environment-model");
  });

  it("在没有 ANTHROPIC_MODEL 时读取标准 model 设置", async () => {
    const loadSettings: ClaudeSettingsLoader = async () => ({
      effective: { model: "glm-5.2" },
      provenance: {},
      sources: [],
    });
    const resolver = new SdkClaudeModelResolver(
      new SdkClaudeUserSettingsSource(loadSettings),
    );

    /*
     * 顶层 model 仍是 Claude Code 官方支持的持久模型入口。
     * 该分支保证通过 /model 保存的用户选择可以直接驱动新的 Apex attempt。
     */
    await expect(resolver.resolveModel("C:\\target-project"))
      .resolves.toBe("glm-5.2");
  });

  it("用户配置没有显式模型时拒绝创建不可审计的 attempt", async () => {
    const loadSettings: ClaudeSettingsLoader = async () => ({
      effective: {},
      provenance: {},
      sources: [],
    });
    const resolver = new SdkClaudeModelResolver(
      new SdkClaudeUserSettingsSource(loadSettings),
    );

    /*
     * requestedModel 必须来自明确配置，不能拿 SDK 隐式默认值填充运行状态。
     * 两个官方入口都缺失时提前失败，让用户在 Agent 工具执行前修正 CC Switch 选择。
     */
    await expect(resolver.resolveModel("C:\\target-project"))
      .rejects.toThrow("Claude 用户配置缺少 env.ANTHROPIC_MODEL 或 model");
  });

  it("从 Claude 用户配置读取 CC Switch 当前连接字段", async () => {
    let receivedOptions: Parameters<ClaudeSettingsLoader>[0];
    const loadSettings: ClaudeSettingsLoader = async (options) => {
      receivedOptions = options;
      return {
        effective: {
          apiKeyHelper: "trusted-api-key-helper",
          proxyAuthHelper: "trusted-proxy-helper",
          env: {
            ANTHROPIC_AUTH_TOKEN: "secret-token",
            ANTHROPIC_BASE_URL: "https://gateway.example.test",
          },
          model: "user-model-preference",
          permissions: { allow: ["Bash(*)"] },
          enabledPlugins: { "unsafe@example": true },
        },
        provenance: {},
        sources: [],
      };
    };
    const resolver = new SdkClaudeConnectionSettingsResolver(
      new SdkClaudeUserSettingsSource(loadSettings),
    );

    const settings = await resolver.resolve("C:\\target-project");

    expect(receivedOptions).toEqual({
      cwd: "C:\\target-project",
      settingSources: ["user"],
    });
    expect(settings).toEqual({
      apiKeyHelper: "trusted-api-key-helper",
      proxyAuthHelper: "trusted-proxy-helper",
      env: {
        ANTHROPIC_AUTH_TOKEN: "secret-token",
        ANTHROPIC_BASE_URL: "https://gateway.example.test",
      },
    });
    expect(settings).not.toHaveProperty("model");
    expect(settings).not.toHaveProperty("permissions");
    expect(settings).not.toHaveProperty("enabledPlugins");
  });

  it("每次会话重新读取 Claude 用户配置而不缓存 Provider", async () => {
    let loadCount = 0;
    const loadSettings: ClaudeSettingsLoader = async () => {
      loadCount += 1;
      return {
        effective: {
          env: {
            ANTHROPIC_AUTH_TOKEN: `provider-token-${loadCount}`,
          },
        },
        provenance: {},
        sources: [],
      };
    };
    const resolver = new SdkClaudeConnectionSettingsResolver(
      new SdkClaudeUserSettingsSource(loadSettings),
    );

    /*
     * 模拟两次 Agent 会话之间由 CC Switch 改写 Claude 用户配置。
     * 第二次解析必须看到新 Provider，不能复用 Apex 内存中的旧认证快照。
     */
    const first = await resolver.resolve("C:\\target-project");
    const second = await resolver.resolve("C:\\target-project");

    expect(first.env?.ANTHROPIC_AUTH_TOKEN).toBe("provider-token-1");
    expect(second.env?.ANTHROPIC_AUTH_TOKEN).toBe("provider-token-2");
    expect(loadCount).toBe(2);
  });
});
