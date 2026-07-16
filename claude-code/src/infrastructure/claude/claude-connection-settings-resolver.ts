/*
 * Reviewer 的权限隔离不能同时切断 Claude Code 的认证与模型连接配置。
 * CC Switch 只是 Claude 用户配置的上游写入者；Apex 始终通过 Claude SDK 解析当前生效配置，
 * 不读取 cc-switch.db、不保存独立凭据，也不建立第二套登录状态。
 */
import type { Settings } from "@anthropic-ai/claude-agent-sdk";
import {
  SdkClaudeUserSettingsSource,
  type ClaudeUserSettingsSource,
} from "./claude-user-settings-source.js";

export type ClaudeConnectionSettings = Pick<
  Settings,
  | "apiKeyHelper"
  | "proxyAuthHelper"
  | "awsCredentialExport"
  | "awsAuthRefresh"
  | "gcpAuthRefresh"
  | "env"
>;

export interface ClaudeConnectionSettingsResolver {
  resolve(cwd: string): Promise<ClaudeConnectionSettings>;
}

export class SdkClaudeConnectionSettingsResolver
implements ClaudeConnectionSettingsResolver {
  public constructor(
    private readonly settingsSource: ClaudeUserSettingsSource
      = new SdkClaudeUserSettingsSource(),
  ) {}

  public async resolve(cwd: string): Promise<ClaudeConnectionSettings> {
    /*
     * 只允许 user 源参与普通设置合并；SDK 仍会按自身规则叠加管理员托管设置。
     * 不读取 project/local，防止目标仓库通过环境、认证辅助命令或代理配置影响独立 Reviewer。
     * 每次新会话都重新解析，不做 Apex 侧缓存，因此 CC Switch 后续切换会自然作用于下一会话。
     */
    const settings = await this.settingsSource.load(cwd);
    return selectClaudeConnectionSettings(settings);
  }
}

export function selectClaudeConnectionSettings(
  settings: Settings,
): ClaudeConnectionSettings {
  /*
   * 显式逐字段投影形成封闭的数据边界。权限、Hook、插件、MCP、技能和模型偏好等
   * 非连接设置即使存在于用户配置中，也不会被重新注入隔离 Reviewer。
   */
  return {
    ...(settings.apiKeyHelper === undefined
      ? {}
      : { apiKeyHelper: settings.apiKeyHelper }),
    ...(settings.proxyAuthHelper === undefined
      ? {}
      : { proxyAuthHelper: settings.proxyAuthHelper }),
    ...(settings.awsCredentialExport === undefined
      ? {}
      : { awsCredentialExport: settings.awsCredentialExport }),
    ...(settings.awsAuthRefresh === undefined
      ? {}
      : { awsAuthRefresh: settings.awsAuthRefresh }),
    ...(settings.gcpAuthRefresh === undefined
      ? {}
      : { gcpAuthRefresh: settings.gcpAuthRefresh }),
    ...(settings.env === undefined ? {} : { env: { ...settings.env } }),
  };
}
