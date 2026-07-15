/*
 * GitWorkspace 使用规范化仓库身份、显式 pathspec 和候选内容指纹把门禁、审核与提交绑定到同一版本。
 * 提交只接受预期 HEAD 与预期候选，精确 trailer 用于恢复提交后、状态落盘前的唯一崩溃窗口。
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { minimatch } from "minimatch";
import { ConfigurationError, InfrastructureError } from "../../domain/errors.js";
import type { TaskDefinition } from "../../domain/manifest.js";
import type {
  CandidateSnapshot,
  CandidateArchive,
  ChangeAuditResult,
  VerificationWorkspace,
  VerificationWorkspaceRelease,
  TaskCompletionEvidence,
  Workspace,
  WorkspaceIdentity,
} from "../../ports/workspace.js";
import { VerificationWorktreeLease } from "./verification-worktree-lease.js";

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
    const files: CandidateSnapshot["files"][number][] = [];

    for (const relativePath of changedFiles) {
      const absolutePath = resolve(this.projectRoot, relativePath);
      try {
        const metadata = await lstat(absolutePath);
        if (metadata.isSymbolicLink()) {
          const target = await readlink(absolutePath);
          files.push({
            path: relativePath,
            kind: "symlink",
            mode: metadata.mode,
            contentHash: createHash("sha256").update(target).digest("hex"),
          });
        } else if (metadata.isFile()) {
          const content = await readFile(absolutePath);
          files.push({
            path: relativePath,
            kind: "file",
            mode: metadata.mode,
            contentHash: createHash("sha256").update(content).digest("hex"),
          });
        } else {
          throw new InfrastructureError(
            `候选变更包含不支持的文件类型：${relativePath}`,
          );
        }
      } catch (error) {
        if (isMissingPath(error)) {
          files.push({
            path: relativePath,
            kind: "deleted",
            mode: 0,
            contentHash: createHash("sha256").update("").digest("hex"),
          });
          continue;
        }
        throw error;
      }
    }

    /*
     * 指纹由规范化文件记录组成，不依赖暂存区状态或 Git diff 的文本表现。
     * 同一候选在主工作区与隔离 worktree 中会得到完全相同的可比较结果。
     */
    for (const file of files) {
      hash.update(file.path);
      hash.update("\0");
      hash.update(file.kind);
      hash.update("\0");
      hash.update(String(file.mode));
      hash.update("\0");
      hash.update(file.contentHash);
      hash.update("\0");
    }

    return {
      fingerprint: hash.digest("hex"),
      diff: await this.createReviewDiff(),
      files,
    };
  }

  /*
   * 门禁在独立 detached worktree 中运行，主候选不会被验证命令直接改写。
   * 只复制 Git 候选文件，并通过显式 sharedPaths 复用 node_modules 等依赖目录。
   */
  public async openVerificationWorkspace(input: {
    runId: string;
    taskId: string;
    sharedPaths: readonly string[];
    expectedCandidate: CandidateSnapshot;
  }): Promise<VerificationWorkspace> {
    const repositoryRoot = (await this.git(["rev-parse", "--show-toplevel"])).trim();
    const projectPrefix = normalize(
      (await this.git(["rev-parse", "--show-prefix"])).trim(),
    );
    for (const sharedPath of input.sharedPaths) {
      resolveProjectPath(this.projectRoot, sharedPath);
    }
    const temporaryRoot = await mkdtemp(join(tmpdir(), "claude-task-verification-"));
    const worktreeRoot = join(temporaryRoot, "worktree");
    const verificationProjectRoot = projectPrefix.length === 0
      ? worktreeRoot
      : resolve(worktreeRoot, projectPrefix);
    const lease = new VerificationWorktreeLease({
      repositoryRoot,
      worktreeRoot,
      temporaryRoot,
      sharedPathLinks: input.sharedPaths.map((sharedPath) =>
        resolveProjectPath(verificationProjectRoot, sharedPath)
      ),
    });

    try {
      await this.gitAt(repositoryRoot, [
        "worktree",
        "add",
        "--detach",
        worktreeRoot,
        "HEAD",
      ]);
      for (const file of input.expectedCandidate.files) {
        await copyCandidatePath(
          this.projectRoot,
          verificationProjectRoot,
          file.path,
        );
      }
      for (const sharedPath of input.sharedPaths) {
        await linkSharedPath(
          this.projectRoot,
          verificationProjectRoot,
          sharedPath,
        );
      }

      const isolatedWorkspace = new GitWorkspace(verificationProjectRoot);
      const isolatedCandidate = await isolatedWorkspace.captureCandidate();
      if (isolatedCandidate.fingerprint !== input.expectedCandidate.fingerprint) {
        throw new InfrastructureError(
          `隔离验证候选与源候选不一致：${input.taskId}`,
        );
      }
      return new GitVerificationWorkspace({
        sourceProjectRoot: this.projectRoot,
        projectRoot: verificationProjectRoot,
        workspace: isolatedWorkspace,
        lease,
      });
    } catch (error) {
      /*
       * 初始化失败必须保留原始异常语义；释放诊断只描述临时资源，不能覆盖候选复制或
       * 指纹校验的真正根因。lease 内部会完成 Git 删除、文件系统兜底和注册修剪。
       */
      await lease.release().catch(() => undefined);
      throw error;
    }
  }

  /*
   * 终态任务的未提交候选先写入专用 Git 引用，再从主工作区精确清除。
   * 这样独立 DAG 分支可以继续执行，同时阻塞任务的完整文件树仍可审计和恢复。
   */
  public async quarantineCandidate(input: {
    runId: string;
    taskId: string;
  }): Promise<CandidateArchive> {
    const referenceKey = createHash("sha256")
      .update(`${input.runId}\0${input.taskId}`)
      .digest("hex")
      .slice(0, 32);
    const reference = `refs/claude-task-orchestrator/quarantine/${referenceKey}`;
    const existingCommit = (
      await this.git(["for-each-ref", "--format=%(objectname)", reference])
    ).trim();

    /*
     * 引用创建与状态 checkpoint 之间发生崩溃时，恢复流程必须复用已有完整归档。
     * 即使主工作区已经部分或全部清理，也不能用不完整候选覆盖先前引用。
     */
    if (existingCommit.length > 0) {
      const archivedFiles = await this.gitNullList([
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "--no-renames",
        "-r",
        "-z",
        "--relative",
        `${existingCommit}^`,
        existingCommit,
        "--",
        ".",
      ]);
      await this.clearProjectCandidate();
      return { reference, changedFiles: archivedFiles };
    }

    const changedFiles = await this.getChangedProjectFiles();
    if (changedFiles.length === 0) {
      return { changedFiles: [] };
    }

    const temporaryRoot = await mkdtemp(join(tmpdir(), "claude-task-archive-"));
    const temporaryIndex = join(temporaryRoot, "index");
    const environment = {
      ...process.env,
      GIT_INDEX_FILE: temporaryIndex,
    };
    try {
      await this.gitAt(this.projectRoot, ["read-tree", "HEAD"], environment);
      await this.gitAt(
        this.projectRoot,
        ["add", "--all", "--", "."],
        environment,
      );
      const tree = (
        await this.gitAt(this.projectRoot, ["write-tree"], environment)
      ).trim();
      const commit = (
        await this.gitAt(
          this.projectRoot,
          [
            "commit-tree",
            tree,
            "-p",
            "HEAD",
            "-m",
            `隔离 ${input.runId} ${input.taskId} 的未完成候选`,
          ],
          environment,
        )
      ).trim();
      await this.git(["update-ref", reference, commit]);
      await this.clearProjectCandidate();
      return { reference, changedFiles };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  public async commitTask(input: {
    runId: string;
    task: TaskDefinition;
    messagePrefix: string;
    expectedHead: string;
    expectedFingerprint: string;
    taskContractHash: string;
    dependencyFingerprint: string;
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

    await this.git(["add", "--all", "--", "."]);
    await this.assertCandidate(input.expectedFingerprint);
    const projectHistoryKey = await this.getProjectHistoryKey();
    const message = [
      `${input.messagePrefix}: ${input.task.id} ${input.task.title}`,
      "",
      `Orchestrator-Run: ${input.runId}`,
      `Orchestrator-Project: ${projectHistoryKey}`,
      `Orchestrator-Task: ${input.task.id}`,
      `Orchestrator-Candidate: ${input.expectedFingerprint}`,
      `Orchestrator-Task-Contract: ${input.taskContractHash}`,
      `Orchestrator-Task-Dependencies: ${input.dependencyFingerprint}`,
    ].join("\n");
    /*
     * --fresh 或人工预先实现可能得到“代码无变化但门禁与审核通过”的合法结果。
     * 空提交只记录完成证据；非空候选仍使用项目 pathspec，绝不夹带父仓库其他目录的改动。
     */
    const commitArguments = [
      "commit",
      "--no-verify",
      "--no-gpg-sign",
      ...(changedFiles.length === 0 ? ["--allow-empty"] : ["--only"]),
      "-m",
      message,
      ...(changedFiles.length === 0 ? [] : ["--", "."]),
    ];
    await this.git(commitArguments);
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

  /*
   * Git 历史是项目级完成账本：只搜索当前 HEAD 的祖先，并要求任务、契约和依赖三项 trailer 精确匹配。
   * 选择最近匹配提交可以复用同一契约的最新完成事实，同时自动排除其他分支和被改写掉的历史。
   */
  public async readTaskCompletionHistory(
    head: string,
  ): Promise<readonly TaskCompletionEvidence[]> {
    const projectHistoryKey = await this.getProjectHistoryKey();
    const history = await this.git([
      "log",
      "--format=%H%x00%B%x00",
      "--fixed-strings",
      `--grep=Orchestrator-Project: ${projectHistoryKey}`,
      head,
    ]);
    const fields = history.split("\0");
    const evidence: TaskCompletionEvidence[] = [];
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const commitSha = fields[index]?.trim();
      const body = fields[index + 1];
      if (commitSha === undefined || commitSha.length === 0 || body === undefined) {
        continue;
      }
      const trailers = parseExactTrailers(body);
      const taskId = trailers.get("Orchestrator-Task");
      const runId = trailers.get("Orchestrator-Run");
      const project = trailers.get("Orchestrator-Project");
      const taskContractHash = trailers.get("Orchestrator-Task-Contract");
      const dependencyFingerprint = trailers.get(
        "Orchestrator-Task-Dependencies",
      );
      if (
        taskId !== undefined
        && runId !== undefined
        && project === projectHistoryKey
        && taskContractHash !== undefined
        && dependencyFingerprint !== undefined
      ) {
        evidence.push({
          taskId,
          commitSha,
          runId,
          taskContractHash,
          dependencyFingerprint,
        });
      }
    }
    return evidence;
  }

  /*
   * 空完成提交没有文件路径，读取历史时不能依赖 pathspec 过滤；项目键用于隔离同一父仓库中的多个子项目。
   * Git 前缀经哈希后写入 trailer，根项目统一以点号参与哈希，避免特殊路径字符注入提交元数据。
   */
  private async getProjectHistoryKey(): Promise<string> {
    const prefix = normalize(
      (await this.git(["rev-parse", "--show-prefix"])).trim(),
    ).replace(/\/$/u, "");
    return createHash("sha256")
      .update(prefix.length === 0 ? "." : prefix)
      .digest("hex");
  }

  private async assertCandidate(expectedFingerprint: string): Promise<void> {
    const candidate = await this.captureCandidate();
    if (candidate.fingerprint !== expectedFingerprint) {
      throw new InfrastructureError(
        "候选内容已变化，拒绝提交未经当前门禁和审核的版本",
      );
    }
  }

  private async clearProjectCandidate(): Promise<void> {
    await this.git([
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

  private async createReviewDiff(): Promise<string> {
    /*
     * --relative 让 diff header 与 TASK scope 共用项目根坐标系。
     * 父仓库子项目因此不会把仓库目录前缀泄漏到 Reviewer 提示词。
     */
    const trackedDiff = await this.git([
      "diff",
      "--binary",
      "--no-ext-diff",
      "--unified=80",
      "--relative",
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
    /*
     * tracked 和 untracked 列表必须都以 projectRoot 为基准，否则同一文件会因 Git 子命令不同
     * 得到两种路径表示，并在 allow/deny/protected 审计时产生错误结论。
     */
    const [tracked, untracked] = await Promise.all([
      this.gitNullList([
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

  private async gitAt(
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

}

interface GitVerificationWorkspaceInput {
  readonly sourceProjectRoot: string;
  readonly projectRoot: string;
  readonly workspace: GitWorkspace;
  readonly lease: VerificationWorktreeLease;
}

/*
 * 该适配器只暴露验证阶段需要的最小能力，不允许门禁在隔离目录中提交或操作运行状态。
 * promoteCandidate 是唯一回写入口，调用者必须先完成 scope/protected 审计。
 */
class GitVerificationWorkspace implements VerificationWorkspace {
  public readonly projectRoot: string;

  public constructor(private readonly input: GitVerificationWorkspaceInput) {
    this.projectRoot = input.projectRoot;
  }

  public auditChanges(
    task: TaskDefinition,
    protectedPaths: readonly string[],
  ): Promise<ChangeAuditResult> {
    return this.input.workspace.auditChanges(task, protectedPaths);
  }

  public captureCandidate(): Promise<CandidateSnapshot> {
    return this.input.workspace.captureCandidate();
  }

  public async promoteCandidate(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      await copyCandidatePath(
        this.input.projectRoot,
        this.input.sourceProjectRoot,
        path,
      );
    }
  }

  public dispose(): Promise<VerificationWorkspaceRelease> {
    return this.input.lease.release();
  }
}

/*
 * 候选复制严格按 Git 返回的项目相对路径执行，并拒绝目录型候选。
 * 源路径不存在表示删除语义，目标文件会被精确移除而不会递归清理未知目录。
 */
async function copyCandidatePath(
  sourceRoot: string,
  targetRoot: string,
  relativePath: string,
): Promise<void> {
  const sourcePath = resolveProjectPath(sourceRoot, relativePath);
  const targetPath = resolveProjectPath(targetRoot, relativePath);
  try {
    const metadata = await lstat(sourcePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await rm(targetPath, { force: true });
    if (metadata.isSymbolicLink()) {
      const target = await readlink(sourcePath);
      const followed = await stat(sourcePath);
      await symlink(
        target,
        targetPath,
        followed.isDirectory()
          ? process.platform === "win32" ? "junction" : "dir"
          : "file",
      );
      return;
    }
    if (!metadata.isFile()) {
      throw new InfrastructureError(`候选路径不是普通文件：${relativePath}`);
    }
    await copyFile(sourcePath, targetPath);
    await chmod(targetPath, metadata.mode);
  } catch (error) {
    if (isMissingPath(error)) {
      await rm(targetPath, { force: true });
      return;
    }
    throw error;
  }
}

async function linkSharedPath(
  sourceRoot: string,
  targetRoot: string,
  relativePath: string,
): Promise<void> {
  const sourcePath = resolveProjectPath(sourceRoot, relativePath);
  const targetPath = resolveProjectPath(targetRoot, relativePath);
  let metadata;
  try {
    metadata = await stat(sourcePath);
  } catch (error) {
    if (isMissingPath(error)) {
      throw new InfrastructureError(`验证共享路径不存在：${relativePath}`);
    }
    throw error;
  }
  if (await pathExists(targetPath)) {
    throw new InfrastructureError(`验证共享路径覆盖了 Git 文件：${relativePath}`);
  }
  await mkdir(dirname(targetPath), { recursive: true });
  await symlink(
    sourcePath,
    targetPath,
    metadata.isDirectory()
      ? process.platform === "win32" ? "junction" : "dir"
      : "file",
  );
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
  const normalizedRoot = normalize(resolve(projectRoot));
  const normalizedPath = normalize(absolutePath);
  if (
    normalizedPath === normalizedRoot
    || !normalizedPath.startsWith(`${normalizedRoot}/`)
  ) {
    throw new InfrastructureError(`候选路径越界：${relativePath}`);
  }
  return absolutePath;
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

function normalize(path: string): string {
  return path.replaceAll("\\", "/");
}

function splitNullList(output: string): readonly string[] {
  return output.split("\0").filter(Boolean);
}

/*
 * 完成证据只接受恰好出现一次的精确 trailer；重复键会被视为歧义并拒绝复用。
 * 解析器不依赖提交标题或自由文本，因此任务名包含相似前缀时也不会发生误匹配。
 */
function parseExactTrailers(body: string): ReadonlyMap<string, string> {
  const values = new Map<string, string[]>();
  for (const line of body.split(/\r?\n/u)) {
    const match = /^(Orchestrator-[A-Za-z-]+):\s*(.+)$/u.exec(line.trim());
    if (match?.[1] === undefined || match[2] === undefined) {
      continue;
    }
    const existing = values.get(match[1]) ?? [];
    existing.push(match[2]);
    values.set(match[1], existing);
  }
  return new Map(
    [...values.entries()]
      .filter(([, entries]) => entries.length === 1)
      .map(([key, entries]) => [key, entries[0] as string]),
  );
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
