/*
 * GitWorkspace 使用规范化仓库身份、显式 pathspec 和候选内容指纹把门禁、审核与提交绑定到同一版本。
 * 提交只接受预期 HEAD 与预期候选，精确 trailer 用于恢复提交后、状态落盘前的唯一崩溃窗口。
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  readFile,
  readlink,
  realpath,
} from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { minimatch } from "minimatch";
import { ConfigurationError, InfrastructureError } from "../../domain/errors.js";
import type { TaskDefinition } from "../../domain/manifest.js";
import type {
  CandidateSnapshot,
  ChangeAuditResult,
  Workspace,
  WorkspaceIdentity,
} from "../../ports/workspace.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 20 * 1024 * 1024;
const MAX_UNTRACKED_PREVIEW_BYTES = 100_000;
const GIT_COMMAND_TIMEOUT_MS = 120_000;

export class GitWorkspace implements Workspace {
  public constructor(private readonly projectRoot: string) {}

  public async getStateDirectory(): Promise<string> {
    const commonDirectory = await this.git(["rev-parse", "--git-common-dir"]);
    const absoluteCommonDirectory = await realpath(
      resolve(this.projectRoot, commonDirectory.trim()),
    );
    const canonicalProjectRoot = await realpath(this.projectRoot);
    const projectIdentity = process.platform === "win32"
      ? normalize(canonicalProjectRoot).toLowerCase()
      : normalize(canonicalProjectRoot);
    const projectKey = createHash("sha256")
      .update(projectIdentity)
      .digest("hex")
      .slice(0, 16);
    return resolve(
      absoluteCommonDirectory,
      "claude-task-orchestrator",
      projectKey,
    );
  }

  public async getIdentity(): Promise<WorkspaceIdentity> {
    const [repositoryRoot, branch, head] = await Promise.all([
      this.git(["rev-parse", "--show-toplevel"]),
      this.git(["rev-parse", "--abbrev-ref", "HEAD"]),
      this.git(["rev-parse", "HEAD"]),
    ]);
    return {
      repositoryRoot: normalize(await realpath(repositoryRoot.trim())),
      branch: branch.trim(),
      head: head.trim(),
    };
  }

  public async assertClean(): Promise<void> {
    const status = await this.git([
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

  public async auditChanges(
    task: TaskDefinition,
    protectedPaths: readonly string[],
  ): Promise<ChangeAuditResult> {
    const changedFiles = await this.getChangedProjectFiles();
    const protectedSet = new Set(protectedPaths.map(normalize));
    const violations = changedFiles.filter((file) => {
      const normalized = normalize(file);
      const isProtected = protectedSet.has(normalized);
      const isDenied = task.scope.deny.some((pattern) =>
        minimatch(normalized, normalize(pattern), { dot: true }));
      const isAllowed = task.scope.allow.some((pattern) =>
        minimatch(normalized, normalize(pattern), { dot: true }));
      return isProtected || isDenied || !isAllowed;
    });

    return { changedFiles, violations };
  }

  public async captureCandidate(): Promise<CandidateSnapshot> {
    const changedFiles = await this.getChangedProjectFiles();
    const hash = createHash("sha256");

    for (const relativePath of changedFiles) {
      const absolutePath = resolve(this.projectRoot, relativePath);
      hash.update(relativePath);
      hash.update("\0");
      try {
        const metadata = await lstat(absolutePath);
        hash.update(String(metadata.mode));
        hash.update("\0");
        if (metadata.isSymbolicLink()) {
          hash.update("symlink\0");
          hash.update(await readlink(absolutePath));
        } else if (metadata.isFile()) {
          hash.update("file\0");
          hash.update(await readFile(absolutePath));
        } else {
          throw new InfrastructureError(
            `候选变更包含不支持的文件类型：${relativePath}`,
          );
        }
      } catch (error) {
        if (isMissingPath(error)) {
          hash.update("deleted");
          continue;
        }
        throw error;
      }
      hash.update("\0");
    }

    return {
      fingerprint: hash.digest("hex"),
      diff: await this.createReviewDiff(),
    };
  }

  public async commitTask(input: {
    runId: string;
    task: TaskDefinition;
    messagePrefix: string;
    expectedHead: string;
    expectedFingerprint: string;
  }): Promise<string> {
    const identity = await this.getIdentity();
    if (identity.head !== input.expectedHead) {
      throw new InfrastructureError(
        `提交前 HEAD 已变化：期望 ${input.expectedHead}，实际 ${identity.head}`,
      );
    }

    const outsideChanges = await this.getChangesOutsideProject();
    if (outsideChanges.length > 0) {
      throw new InfrastructureError(
        `父仓库出现项目外改动，拒绝提交：${outsideChanges.join(", ")}`,
      );
    }

    await this.assertCandidate(input.expectedFingerprint);
    const changedFiles = await this.getChangedProjectFiles();
    if (changedFiles.length === 0) {
      throw new InfrastructureError(`任务 ${input.task.id} 没有可提交的文件变更`);
    }

    await this.git(["add", "--all", "--", "."]);
    await this.assertCandidate(input.expectedFingerprint);
    const message = [
      `${input.messagePrefix}: ${input.task.id} ${input.task.title}`,
      "",
      `Orchestrator-Run: ${input.runId}`,
      `Orchestrator-Task: ${input.task.id}`,
      `Orchestrator-Candidate: ${input.expectedFingerprint}`,
    ].join("\n");
    await this.git([
      "commit",
      "--no-verify",
      "--no-gpg-sign",
      "--only",
      "-m",
      message,
      "--",
      ".",
    ]);
    const commitSha = (await this.git(["rev-parse", "HEAD"])).trim();
    await this.assertClean();
    return commitSha;
  }

  public async findTaskCommit(input: {
    runId: string;
    taskId: string;
    expectedParent: string;
    candidateFingerprint: string;
  }): Promise<string | undefined> {
    const head = (await this.git(["rev-parse", "HEAD"])).trim();
    const body = await this.git(["log", "-1", "--format=%B", "HEAD"]);
    const trailerLines = new Set(
      body.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean),
    );
    const matches = trailerLines.has(`Orchestrator-Run: ${input.runId}`)
      && trailerLines.has(`Orchestrator-Task: ${input.taskId}`)
      && trailerLines.has(
        `Orchestrator-Candidate: ${input.candidateFingerprint}`,
      );
    if (!matches) {
      return undefined;
    }
    const parent = (await this.git(["rev-parse", `${head}^`])).trim();
    return parent === input.expectedParent ? head : undefined;
  }

  private async assertCandidate(expectedFingerprint: string): Promise<void> {
    const candidate = await this.captureCandidate();
    if (candidate.fingerprint !== expectedFingerprint) {
      throw new InfrastructureError(
        "候选内容已变化，拒绝提交未经当前门禁和审核的版本",
      );
    }
  }

  private async createReviewDiff(): Promise<string> {
    const trackedDiff = await this.git([
      "diff",
      "--binary",
      "--no-ext-diff",
      "--unified=80",
      "HEAD",
      "--",
      ".",
    ]);
    const untrackedFiles = await this.getUntrackedProjectFiles();
    const previews: string[] = [];
    for (const relativePath of untrackedFiles) {
      const content = await readFile(resolve(this.projectRoot, relativePath));
      const preview = content.length <= MAX_UNTRACKED_PREVIEW_BYTES
        && !content.includes(0)
        ? content.toString("utf8")
        : `<二进制或超大新文件；请直接读取 ${relativePath}>`;
      previews.push([
        `diff --orchestrator-new-file ${relativePath}`,
        preview,
      ].join("\n"));
    }
    return [trackedDiff, ...previews].filter(Boolean).join("\n\n");
  }

  private async getChangedProjectFiles(): Promise<readonly string[]> {
    const [tracked, untracked] = await Promise.all([
      this.gitNullList([
        "diff",
        "HEAD",
        "--name-only",
        "--no-renames",
        "-z",
        "--",
        ".",
      ]),
      this.getUntrackedProjectFiles(),
    ]);
    return [...new Set([...tracked, ...untracked].map(normalize))]
      .filter(Boolean)
      .sort();
  }

  private async getUntrackedProjectFiles(): Promise<readonly string[]> {
    return this.gitNullList([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
    ]);
  }

  private async getChangesOutsideProject(): Promise<readonly string[]> {
    const repositoryRoot = (await this.git(["rev-parse", "--show-toplevel"])).trim();
    const prefix = normalize(
      (await this.git(["rev-parse", "--show-prefix"])).trim(),
    );
    if (prefix.length === 0) {
      return [];
    }
    const [tracked, untracked] = await Promise.all([
      this.gitNullListAt(repositoryRoot, [
        "diff",
        "HEAD",
        "--name-only",
        "--no-renames",
        "-z",
      ]),
      this.gitNullListAt(repositoryRoot, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]),
    ]);
    return [...new Set([...tracked, ...untracked])]
      .map(normalize)
      .filter((path) => !path.startsWith(prefix))
      .sort();
  }

  private async gitNullList(args: readonly string[]): Promise<readonly string[]> {
    return splitNullList(await this.git(args));
  }

  private async gitNullListAt(
    cwd: string,
    args: readonly string[],
  ): Promise<readonly string[]> {
    return splitNullList(await this.gitAt(cwd, args));
  }

  private async git(args: readonly string[]): Promise<string> {
    return this.gitAt(this.projectRoot, args);
  }

  private async gitAt(cwd: string, args: readonly string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", [...args], {
        cwd,
        encoding: "utf8",
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        windowsHide: true,
        timeout: GIT_COMMAND_TIMEOUT_MS,
      });
      return stdout;
    } catch (error) {
      throw new InfrastructureError(
        `Git 命令失败：git ${args.join(" ")}`,
        { cause: error },
      );
    }
  }
}

function normalize(path: string): string {
  return path.replaceAll("\\", "/");
}

function splitNullList(output: string): readonly string[] {
  return output.split("\0").filter(Boolean);
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
