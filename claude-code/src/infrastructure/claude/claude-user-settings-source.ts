/*
 * ClaudeUserSettingsSource 是 Claude 用户级配置的唯一读取边界，封装 SDK 设置合并规则。
 * 上层投影器只消费已经合并的 Settings，不重复理解 settingSources 或托管配置语义。
 */
import {
  resolveSettings,
  type ResolvedSettings,
  type ResolveSettingsOptions,
  type Settings,
} from "@anthropic-ai/claude-agent-sdk";

export type ClaudeSettingsLoader = (
  options?: ResolveSettingsOptions,
) => Promise<ResolvedSettings>;

export interface ClaudeUserSettingsSource {
  load(cwd: string): Promise<Settings>;
}

export class SdkClaudeUserSettingsSource implements ClaudeUserSettingsSource {
  public constructor(
    private readonly loadSettings: ClaudeSettingsLoader = resolveSettings,
  ) {}

  public async load(cwd: string): Promise<Settings> {
    /*
     * 只允许 user 源参与普通设置合并；SDK 仍按自身规则叠加管理员托管设置。
     * 每次调用都重新读取，不缓存 CC Switch 的可变 Provider 与模型选择。
     */
    const resolved = await this.loadSettings({
      cwd,
      settingSources: ["user"],
    });
    return resolved.effective;
  }
}
