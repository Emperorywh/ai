/*
 * VerificationWorktreeLease 只负责临时 worktree 的幂等释放，不参与候选复制、门禁或状态转换。
 * Git 删除失败后会降级为文件系统清理并修剪注册；即使 Windows 暂时占用文件，也只返回
 * 可观测的 deferred 结果，避免资源回收异常覆盖已经形成的门禁业务结论。
 */
import { execFile } from "node:child_process";
import { lstat, rm } from "node:fs/promises";
import { promisify } from "node:util";
import type { VerificationWorkspaceRelease } from "../../ports/workspace.js";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 120_000;
const MAX_GIT_OUTPUT_BYTES = 20 * 1024 * 1024;
const REMOVE_MAX_RETRIES = 8;
const REMOVE_RETRY_DELAY_MS = 150;

export interface VerificationWorktreeLocation {
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly temporaryRoot: string;
}

export class VerificationWorktreeLease {
  private releaseResult: VerificationWorkspaceRelease | undefined;

  public constructor(private readonly location: VerificationWorktreeLocation) {}

  public async release(): Promise<VerificationWorkspaceRelease> {
    if (this.releaseResult !== undefined) {
      return this.releaseResult;
    }

    const diagnostics: string[] = [];
    const worktreeInitiallyExists = await pathExists(this.location.worktreeRoot);
    let requiresPrune = !worktreeInitiallyExists;
    let registrationReleased = true;

    if (worktreeInitiallyExists) {
      try {
        await this.git([
          "worktree",
          "remove",
          "--force",
          this.location.worktreeRoot,
        ]);
      } catch (error) {
        requiresPrune = true;
        diagnostics.push(`Git worktree remove 未完成：${describeError(error)}`);
      }
    }

    /*
     * worktree 中可能包含指向 node_modules 的 Windows junction，Git 自身删除会偶发失败。
     * Node 的重试式递归删除负责物理目录，随后 prune 只处理 Git 元数据，职责互不混杂。
     */
    await removeDirectory(
      this.location.worktreeRoot,
      "隔离 worktree",
      diagnostics,
    );
    if (requiresPrune) {
      try {
        await this.git(["worktree", "prune", "--expire", "now"]);
      } catch (error) {
        registrationReleased = false;
        diagnostics.push(`Git worktree prune 未完成：${describeError(error)}`);
      }
    }
    await removeDirectory(
      this.location.temporaryRoot,
      "临时目录",
      diagnostics,
    );

    const [worktreeExists, temporaryRootExists] = await Promise.all([
      pathExists(this.location.worktreeRoot),
      pathExists(this.location.temporaryRoot),
    ]);
    const status = worktreeExists || temporaryRootExists || !registrationReleased
      ? "deferred" as const
      : "released" as const;

    /*
     * Git 删除失败但文件系统兜底成功属于已释放，不把过程诊断提升为用户可见故障。
     * 真正仍有路径残留时保留全部诊断，调用方可以记录警告并继续后续任务。
     */
    this.releaseResult = {
      status,
      diagnostics: status === "released" ? [] : diagnostics,
    };
    return this.releaseResult;
  }

  private async git(args: readonly string[]): Promise<void> {
    await execFileAsync("git", [...args], {
      cwd: this.location.repositoryRoot,
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
  }
}

async function removeDirectory(
  path: string,
  label: string,
  diagnostics: string[],
): Promise<void> {
  try {
    await rm(path, {
      recursive: true,
      force: true,
      maxRetries: REMOVE_MAX_RETRIES,
      retryDelay: REMOVE_RETRY_DELAY_MS,
    });
  } catch (error) {
    diagnostics.push(`${label}删除未完成：${describeError(error)}`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
