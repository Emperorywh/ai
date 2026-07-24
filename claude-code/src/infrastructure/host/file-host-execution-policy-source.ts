/*
 * 文件宿主策略来源只读取产品级用户配置目录中的固定文件，不接受项目或命令行覆盖路径。
 * 文件先经过严格 UTF-8/BOM/NUL 校验，再按唯一 YAML → strict domain snapshot 管道编译；
 * 缺失、重复键、旧 schemaVersion 或非法引用全部 fail closed，不提供内置能力 fallback。
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { parse } from "yaml";
import { decodeCanonicalSourceText } from "../../domain/canonical-text.js";
import { ConfigurationError } from "../../domain/errors.js";
import {
  parseHostExecutionPolicySnapshot,
  type HostExecutionPolicySnapshot,
} from "../../domain/host-execution-policy.js";
import type { HostExecutionPolicySource } from "../../ports/host-execution-policy-source.js";

const PRODUCT_CONFIG_DIRECTORY = "apex-coding-agent";
const HOST_POLICY_FILE = "host-execution-policy.yaml";

export class FileHostExecutionPolicySource
  implements HostExecutionPolicySource {
  public constructor(private readonly path: string) {}

  public async load(): Promise<HostExecutionPolicySnapshot> {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(this.path);
    } catch (error) {
      throw new ConfigurationError(
        `宿主执行策略无法读取：${this.path}（${describeError(error)}）`,
      );
    }
    const text = decodeCanonicalSourceText(bytes, "宿主执行策略");
    let input: unknown;
    try {
      input = parse(text);
    } catch (error) {
      throw new ConfigurationError(
        `宿主执行策略 YAML 无法解析：${this.path}（${describeError(error)}）`,
      );
    }
    return parseHostExecutionPolicySnapshot(input, this.path);
  }
}

/*
 * 默认配置位置只由操作系统用户配置目录决定，项目 cwd 和项目内容均不参与解析。
 * 测试可以显式传入 platform/env/home 验证路径规则，生产组合根使用真实宿主事实。
 */
export function resolveDefaultHostExecutionPolicyPath(input: {
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  readonly homeDirectory?: string;
} = {}): string {
  const platform = input.platform ?? process.platform;
  const environment = input.environment ?? process.env;
  const homeDirectory = input.homeDirectory ?? homedir();
  const pathApi = platform === "win32" ? win32 : posix;
  const configRoot = platform === "win32"
    ? environment.APPDATA ?? pathApi.join(homeDirectory, "AppData", "Roaming")
    : environment.XDG_CONFIG_HOME ?? pathApi.join(homeDirectory, ".config");
  if (!pathApi.isAbsolute(configRoot)) {
    throw new ConfigurationError(
      `宿主产品配置目录必须是绝对路径：${configRoot}`,
    );
  }
  return pathApi.join(configRoot, PRODUCT_CONFIG_DIRECTORY, HOST_POLICY_FILE);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
