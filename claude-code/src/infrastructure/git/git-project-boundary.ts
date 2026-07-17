/*
 * GitProjectBoundary 定义子项目在仓库中的安全边界，并集中提供身份、清洁度和路径集合事实。
 * 候选、隔离区和完成账本复用这些查询，避免各组件对 pathspec 产生不同解释。
 */
import { createHash } from "node:crypto";
import { lstat, realpath, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ConfigurationError,
  InfrastructureError,
} from "../../domain/errors.js";
import { PRODUCT_IDENTITY } from "../../product-identity.js";
import type {
  WorkspaceHeadAdvance,
  WorkspaceIdentity,
} from "../../ports/workspace.js";
import { normalizeGitPath } from "./git-command-runner.js";
import type { GitCommandRunner } from "./git-command-runner.js";

export class GitProjectBoundary {
  public constructor(
    private readonly projectRoot: string,
    private readonly git: GitCommandRunner,
  ) {}

  public async getStateDirectory(): Promise<string> {
    const commonDirectory = await this.git.run(["rev-parse", "--git-common-dir"]);
    const absoluteCommonDirectory = await realpath(
      resolve(this.projectRoot, commonDirectory.trim()),
    );
    const canonicalProjectRoot = await realpath(this.projectRoot);
    const projectIdentity = process.platform === "win32"
      ? normalizeGitPath(canonicalProjectRoot).toLowerCase()
      : normalizeGitPath(canonicalProjectRoot);
    const projectKey = createHash("sha256")
      .update(projectIdentity)
      .digest("hex")
      .slice(0, 16);
    return resolve(absoluteCommonDirectory, PRODUCT_IDENTITY.slug, projectKey);
  }

  public async getLockDirectory(): Promise<string> {
    /*
     * 兄弟子项目共享同一 worktree 的 HEAD、索引与文件树，因此必须竞争同一把锁。
     * linked worktree 拥有独立 git-dir，可在不共享这些可变资源时保持并行能力。
     */
    const gitDirectory = await this.git.run(["rev-parse", "--git-dir"]);
    const absoluteGitDirectory = await realpath(
      resolve(this.projectRoot, gitDirectory.trim()),
    );
    return resolve(absoluteGitDirectory, PRODUCT_IDENTITY.slug);
  }

  public async getIdentity(): Promise<WorkspaceIdentity> {
    const [repositoryRoot, branch, head] = await Promise.all([
      this.git.run(["rev-parse", "--show-toplevel"]),
      this.git.run(["rev-parse", "--abbrev-ref", "HEAD"]),
      this.git.run(["rev-parse", "HEAD"]),
    ]);
    return {
      repositoryRoot: normalizeGitPath(await realpath(repositoryRoot.trim())),
      branch: branch.trim(),
      head: head.trim(),
    };
  }

  public async inspectHeadAdvance(input: {
    expectedHead: string;
    currentHead: string;
  }): Promise<WorkspaceHeadAdvance> {
    /*
     * merge-base 精确区分快进与分叉/回退；只有快进关系才继续比较项目树。
     * 端点树无差异即可证明已审核候选仍以相同项目内容为基线，不依赖中间提交标题或作者。
     */
    const mergeBase = (
      await this.git.run([
        "merge-base",
        input.expectedHead,
        input.currentHead,
      ])
    ).trim();
    if (mergeBase !== input.expectedHead) {
      return { kind: "diverged" };
    }
    const changedProjectFiles = await this.git.nullList([
      "diff",
      input.expectedHead,
      input.currentHead,
      "--name-only",
      "--no-renames",
      "--relative",
      "-z",
      "--",
      ".",
    ]);
    return {
      kind: "descendant",
      changedProjectFiles: [...changedProjectFiles]
        .map(normalizeGitPath)
        .filter(Boolean)
        .sort(),
    };
  }

  public async assertClean(): Promise<void> {
    const status = await this.git.run([
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    if (status.length > 0) {
      throw new ConfigurationError(
        "启动新运行前整个 Git 仓库必须干净，以避免覆盖或提交用户已有改动。",
      );
    }
  }

  public async getChangedProjectFiles(): Promise<readonly string[]> {
    /*
     * tracked 与 untracked 始终以 projectRoot 为坐标系，候选指纹、审核和提交由此共享稳定路径。
     * 去重和排序在边界层完成，上层组件不能依赖 Git 子命令的原始枚举顺序。
     */
    const [tracked, untracked] = await Promise.all([
      this.git.nullList([
        "diff",
        "HEAD",
        "--name-only",
        "--no-renames",
        "--relative",
        "-z",
        "--",
        ".",
      ]),
      this.getUntrackedProjectFiles(),
    ]);
    return [...new Set([...tracked, ...untracked].map(normalizeGitPath))]
      .filter(Boolean)
      .sort();
  }

  public getUntrackedProjectFiles(): Promise<readonly string[]> {
    return this.git.nullList([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
    ]);
  }

  public async getChangesOutsideProject(): Promise<readonly string[]> {
    const repositoryRoot = (
      await this.git.run(["rev-parse", "--show-toplevel"])
    ).trim();
    const prefix = normalizeGitPath(
      (await this.git.run(["rev-parse", "--show-prefix"])).trim(),
    );
    if (prefix.length === 0) {
      return [];
    }
    const [tracked, untracked] = await Promise.all([
      this.git.nullListAt(repositoryRoot, [
        "diff",
        "HEAD",
        "--name-only",
        "--no-renames",
        "-z",
      ]),
      this.git.nullListAt(repositoryRoot, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]),
    ]);
    return [...new Set([...tracked, ...untracked])]
      .map(normalizeGitPath)
      .filter((path) => !path.startsWith(prefix))
      .sort();
  }

  public async getProjectHistoryKey(): Promise<string> {
    const prefix = normalizeGitPath(
      (await this.git.run(["rev-parse", "--show-prefix"])).trim(),
    ).replace(/\/$/u, "");
    return createHash("sha256")
      .update(prefix.length === 0 ? "." : prefix)
      .digest("hex");
  }

  public async clearProjectCandidate(): Promise<void> {
    await this.git.run([
      "restore",
      "--source=HEAD",
      "--staged",
      "--worktree",
      "--",
      ".",
    ]);
    for (const path of await this.getUntrackedProjectFiles()) {
      await removeProjectFile(this.projectRoot, path);
    }
    await this.assertClean();
  }
}

async function removeProjectFile(
  projectRoot: string,
  relativePath: string,
): Promise<void> {
  const absolutePath = resolveProjectPath(projectRoot, relativePath);
  const metadata = await lstat(absolutePath).catch((error: unknown) => {
    if (isMissingPath(error)) {
      return undefined;
    }
    throw error;
  });
  if (metadata === undefined) {
    return;
  }
  if (!metadata.isFile() && !metadata.isSymbolicLink()) {
    throw new InfrastructureError(`拒绝清理非文件候选：${relativePath}`);
  }
  await rm(absolutePath, { force: true });
}

function resolveProjectPath(projectRoot: string, relativePath: string): string {
  const absolutePath = resolve(projectRoot, relativePath);
  const normalizedRoot = normalizeGitPath(resolve(projectRoot));
  const normalizedPath = normalizeGitPath(absolutePath);
  if (
    normalizedPath === normalizedRoot
    || !normalizedPath.startsWith(`${normalizedRoot}/`)
  ) {
    throw new InfrastructureError(`候选路径越界：${relativePath}`);
  }
  return absolutePath;
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
