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
  it("从 Claude 用户配置读取 CC Switch 当前模型", async () => {
    const loadSettings: ClaudeSettingsLoader = async () => ({
      effective: {
        model: "glm-5.2",
        env: { ANTHROPIC_MODEL: "environment-model" },
      },
      provenance: {},
      sources: [],
    });
    const resolver = new SdkClaudeModelResolver(
      new SdkClaudeUserSettingsSource(loadSettings),
    );

    /*
     * 标准 model 是 Claude Code 的模型选择入口，应覆盖同一设置中的环境映射。
     * 解析结果会被应用层持久化为 attempt.requestedModel，并用于 SDK 精确握手。
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
     * 提前失败也能让用户在 Agent 工具执行前修正 CC Switch 选择。
     */
    await expect(resolver.resolveModel("C:\\target-project"))
      .rejects.toThrow("Claude 用户配置缺少 model");
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
