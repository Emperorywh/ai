/*
 * GitCandidateStore 负责候选身份、紧凑审核投影与原子提交，三者共享同一内容指纹协议。
 * 完成历史与终态隔离不属于候选生命周期，分别由专用组件承担。
 */
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CandidateChangedError,
  InfrastructureError,
} from "../../domain/errors.js";
import type { TaskDefinition } from "../../domain/project.js";
import { PRODUCT_IDENTITY } from "../../product-identity.js";
import type {
  CandidateSnapshot,
  ReviewCandidateBundle,
} from "../../ports/workspace.js";
import type { GitCommandRunner } from "./git-command-runner.js";
import type { GitProjectBoundary } from "./git-project-boundary.js";

const MAX_UNTRACKED_PREVIEW_BYTES = 100_000;
const MAX_REVIEW_DIFF_CHARACTERS = 500_000;

export class GitCandidateStore {
  public constructor(
    private readonly projectRoot: string,
    private readonly git: GitCommandRunner,
    private readonly boundary: GitProjectBoundary,
  ) {}

  public async captureCandidate(): Promise<CandidateSnapshot> {
    const changedFiles = await this.boundary.getChangedProjectFiles();
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
     * 指纹只由规范化文件记录组成，不依赖暂存区或 diff 文本表现。
     * 每个字段使用 NUL 分隔，避免不同路径与元数据拼接成相同字节序列。
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
    return { fingerprint: hash.digest("hex"), files };
  }

  public async captureReviewCandidate(): Promise<ReviewCandidateBundle> {
    /*
     * 审核 diff 生成前后各校验一次轻量候选身份，防止并发文件写入让 diff 与 fingerprint 脱节。
     * 大体积 diff 仍只生成一次；身份变化由应用层收敛为显式阻塞，不把不一致材料交给 Reviewer。
     */
    const candidateBefore = await this.captureCandidate();
    const diff = await this.createReviewDiff();
    const candidateAfter = await this.captureCandidate();
    if (candidateBefore.fingerprint !== candidateAfter.fingerprint) {
      throw new CandidateChangedError("审核材料生成期间候选内容发生变化");
    }
    return { candidate: candidateAfter, diff };
  }

  public async commitTask(input: {
    runId: string;
    task: TaskDefinition;
    messagePrefix: string;
    expectedHead: string;
    expectedFingerprint: string;
    taskContractHash: string;
    predecessorFingerprint: string;
  }): Promise<string> {
    const identity = await this.boundary.getIdentity();
    if (identity.head !== input.expectedHead) {
      throw new InfrastructureError(
        `提交前 HEAD 已变化：期望 ${input.expectedHead}，实际 ${identity.head}`,
      );
    }
    const outsideChanges = await this.boundary.getChangesOutsideProject();
    if (outsideChanges.length > 0) {
      throw new InfrastructureError(
        `父仓库出现项目外改动，拒绝提交：${outsideChanges.join(", ")}`,
      );
    }
    await this.assertCandidate(input.expectedFingerprint);
    const changedFiles = await this.boundary.getChangedProjectFiles();
    await this.git.run(["add", "--all", "--", "."]);
    const projectHistoryKey = await this.boundary.getProjectHistoryKey();
    const message = [
      `${input.messagePrefix}: ${input.task.id} ${input.task.title}`,
      "",
      `${PRODUCT_IDENTITY.gitTrailers.run}: ${input.runId}`,
      `${PRODUCT_IDENTITY.gitTrailers.project}: ${projectHistoryKey}`,
      `${PRODUCT_IDENTITY.gitTrailers.task}: ${input.task.id}`,
      `${PRODUCT_IDENTITY.gitTrailers.candidate}: ${input.expectedFingerprint}`,
      `${PRODUCT_IDENTITY.gitTrailers.taskContract}: ${input.taskContractHash}`,
      `${PRODUCT_IDENTITY.gitTrailers.taskPredecessor}: ${input.predecessorFingerprint}`,
    ].join("\n");

    /*
     * 无差异任务仍生成完成证据；非空候选只提交当前项目 pathspec，不能夹带父仓库改动。
     * 提交前只校验一次冻结指纹，暂存后不再重复生成完整候选快照。
     */
    await this.git.run([
      "commit",
      "--no-verify",
      "--no-gpg-sign",
      ...(changedFiles.length === 0 ? ["--allow-empty"] : ["--only"]),
      "-m",
      message,
      ...(changedFiles.length === 0 ? [] : ["--", "."]),
    ]);
    const commitSha = (await this.git.run(["rev-parse", "HEAD"])).trim();
    await this.boundary.assertClean();
    return commitSha;
  }

  private async assertCandidate(expectedFingerprint: string): Promise<void> {
    const candidate = await this.captureCandidate();
    if (candidate.fingerprint !== expectedFingerprint) {
      throw new CandidateChangedError(
        "候选内容已变化，拒绝提交未经当前审核确认的版本",
      );
    }
  }

  private async createReviewDiff(): Promise<string> {
    const trackedDiff = await this.git.run([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=8",
      "--relative",
      "HEAD",
      "--",
      ".",
    ]);
    const untrackedFiles = await this.boundary.getUntrackedProjectFiles();
    const previews: string[] = [];
    for (const relativePath of untrackedFiles) {
      const preview = await this.createUntrackedPreview(relativePath);
      previews.push([
        `diff --${PRODUCT_IDENTITY.slug}-new-file ${relativePath}`,
        preview,
      ].join("\n"));
    }
    const combined = [trackedDiff, ...previews].filter(Boolean).join("\n\n");
    if (combined.length <= MAX_REVIEW_DIFF_CHARACTERS) {
      return combined;
    }
    /*
     * Reviewer 提示词保持硬上限；超出部分不继续注入上下文，完整候选文件列表仍会单独提供。
     * Reviewer 可按风险读取任意变更文件，截断标记明确禁止把紧凑投影视为完整代码事实。
     */
    return `${combined.slice(0, MAX_REVIEW_DIFF_CHARACTERS)}\n\n<审核 diff 已达到 ${MAX_REVIEW_DIFF_CHARACTERS} 字符上限；请按变更文件列表直接读取未展示内容>`;
  }

  private async createUntrackedPreview(relativePath: string): Promise<string> {
    const absolutePath = resolve(this.projectRoot, relativePath);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      /*
       * 未跟踪符号链接只能展示链接目标文本，不能跟随到项目外读取内容。
       * 候选指纹采用相同语义，Reviewer 材料与提交身份由此保持一致的安全边界。
       */
      return `<符号链接 -> ${await readlink(absolutePath)}>`;
    }
    if (!metadata.isFile()) {
      throw new InfrastructureError(`审核候选包含不支持的文件类型：${relativePath}`);
    }
    const content = await readFile(absolutePath);
    return content.length <= MAX_UNTRACKED_PREVIEW_BYTES
      && !content.includes(0)
      ? content.toString("utf8")
      : `<二进制或超大新文件；请直接读取 ${relativePath}>`;
  }
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
