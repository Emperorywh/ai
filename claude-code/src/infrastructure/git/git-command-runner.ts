/*
 * GitCommandRunner 是所有 Git 子进程的唯一执行入口，统一超时、输出上限和错误映射。
 * 上层组件只提交参数数组，不能拼接 shell 字符串或各自复制进程策略。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { InfrastructureError } from "../../domain/errors.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 20 * 1024 * 1024;
const GIT_COMMAND_TIMEOUT_MS = 120_000;

export class GitCommandRunner {
  public constructor(private readonly projectRoot: string) {}

  public run(args: readonly string[]): Promise<string> {
    return this.runAt(this.projectRoot, args);
  }

  public async runAt(
    cwd: string,
    args: readonly string[],
    environment?: NodeJS.ProcessEnv,
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", [...args], {
        cwd,
        encoding: "utf8",
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        windowsHide: true,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        ...(environment === undefined ? {} : { env: environment }),
      });
      return stdout;
    } catch (error) {
      throw new InfrastructureError(
        `Git 命令失败：git ${args.join(" ")}`,
        { cause: error },
      );
    }
  }

  public async nullList(args: readonly string[]): Promise<readonly string[]> {
    return splitNullList(await this.run(args));
  }

  public async nullListAt(
    cwd: string,
    args: readonly string[],
  ): Promise<readonly string[]> {
    return splitNullList(await this.runAt(cwd, args));
  }
}

export function normalizeGitPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function splitNullList(output: string): readonly string[] {
  return output.split("\0").filter(Boolean);
}
