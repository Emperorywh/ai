/*
 * 连接设置解析测试验证“认证可用、权限隔离”同时成立。
 * 测试注入内存设置加载器，不读取真实用户凭据，也不启动 Claude Code 子进程。
 */
import { describe, expect, it } from "vitest";
import {
  SdkClaudeConnectionSettingsResolver,
  type ClaudeSettingsLoader,
} from "../src/infrastructure/claude/claude-connection-settings-resolver.js";

describe("SdkClaudeConnectionSettingsResolver", () => {
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
    const resolver = new SdkClaudeConnectionSettingsResolver(loadSettings);

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
    const resolver = new SdkClaudeConnectionSettingsResolver(loadSettings);

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
