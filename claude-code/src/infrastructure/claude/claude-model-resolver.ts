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
   * model 是唯一模型事实源；即使 CC Switch 同时写入环境映射，也不维护第二套解析优先级。
   * 缺少标准字段时直接拒绝启动，避免 fallback 或 SDK 默认值伪造 requestedModel。
   */
  const configuredModel = settings.model?.trim();
  if (configuredModel === undefined || configuredModel.length === 0) {
    throw new ConfigurationError(
      "Claude 用户配置缺少 model，请先通过 CC Switch 选择模型",
    );
  }
  return configuredModel;
}
