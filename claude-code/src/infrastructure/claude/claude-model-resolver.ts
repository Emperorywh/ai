/*
 * Claude 模型投影器只把用户设置转换为应用层可持久化的模型事实。
 * Provider 连接、权限与 SDK Options 不进入该模块，避免模型选择跨越基础设施职责边界。
 */
import type { Settings } from "@anthropic-ai/claude-agent-sdk";
import { ConfigurationError } from "../../domain/errors.js";
import type { AgentModelResolver } from "../../ports/agent-model-resolver.js";
import {
  SdkClaudeUserSettingsSource,
  type ClaudeUserSettingsSource,
} from "./claude-user-settings-source.js";

export class SdkClaudeModelResolver implements AgentModelResolver {
  public constructor(
    private readonly settingsSource: ClaudeUserSettingsSource
      = new SdkClaudeUserSettingsSource(),
  ) {}

  public async resolveModel(cwd: string): Promise<string> {
    const settings = await this.settingsSource.load(cwd);
    return selectClaudeModel(settings);
  }
}

export function selectClaudeModel(settings: Settings): string {
  /*
   * Claude Code 先读取 ANTHROPIC_MODEL，再读取 settings.model；CC Switch 当前把模型写入前者。
   * 这里只复现官方的显式配置优先级，不读取 Provider 数据库，也不使用 SDK 隐式默认模型。
   */
  const environmentModel = settings.env?.ANTHROPIC_MODEL?.trim();
  if (environmentModel !== undefined && environmentModel.length > 0) {
    return environmentModel;
  }

  const configuredModel = settings.model?.trim();
  if (configuredModel === undefined || configuredModel.length === 0) {
    throw new ConfigurationError(
      "Claude 用户配置缺少 env.ANTHROPIC_MODEL 或 model，请先通过 CC Switch 选择模型",
    );
  }
  return configuredModel;
}
