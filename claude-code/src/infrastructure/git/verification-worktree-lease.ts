/*
 * VerificationWorktreeLease 只负责临时 worktree 的幂等释放，不参与候选复制、门禁或状态转换。
 * Git 删除失败后会降级为文件系统清理并修剪注册；即使 Windows 暂时占用文件，也只返回
 * 可观测的 deferred 结果，避免资源回收异常覆盖已经形成的门禁业务结论。
 */
import { execFile } from "node:child_process";
import { lstat, rm, unlink } from "node:fs/promises";
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
  readonly sharedPathLinks: readonly string[];
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
    const sharedPathLinksDetached = !worktreeInitiallyExists
      || await detachSharedPathLinks(
        this.location.sharedPathLinks,
        diagnostics,
      );

    if (worktreeInitiallyExists && sharedPathLinksDetached) {
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

    if (sharedPathLinksDetached) {
      /*
       * 外部共享链接已先从 worktree 命名空间解绑，后续递归删除只会接触临时目录拥有的内容。
       * Node 的重试式删除负责 Git 未清完的物理目录，prune 则只处理残留的 worktree 注册。
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
    }

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

/*
 * sharedPathLinks 指向主项目拥有的 node_modules 等目录，lease 只拥有 worktree 内的链接本身。
 * Windows Git 会沿 junction 递归删除目标，因此任何链接解绑失败时都必须保留整个 worktree，
 * 不能继续调用 Git 或文件系统递归删除；deferred 结果会把清理责任显式留给后续恢复流程。
 */
async function detachSharedPathLinks(
  paths: readonly string[],
  diagnostics: string[],
): Promise<boolean> {
  let allDetached = true;
  const deepestFirst = [...paths].sort((left, right) => right.length - left.length);

  for (const path of deepestFirst) {
    try {
      const metadata = await lstat(path);
      if (!metadata.isSymbolicLink()) {
        continue;
      }
      await unlink(path);
    } catch (error) {
      if (isMissingPath(error)) {
        continue;
      }
      allDetached = false;
      diagnostics.push(`验证共享链接解绑失败：${path}（${describeError(error)}）`);
    }
  }

  return allDetached;
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
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
