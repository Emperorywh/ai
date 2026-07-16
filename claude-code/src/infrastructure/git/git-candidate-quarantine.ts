/*
 * GitCandidateQuarantine 将终态未提交候选保存为确定性 Git 引用，再清理主工作区。
 * 引用创建可重入，恢复时优先复用已归档提交，避免崩溃窗口覆盖完整候选。
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCT_IDENTITY } from "../../product-identity.js";
import type { CandidateArchive } from "../../ports/workspace.js";
import type { GitCommandRunner } from "./git-command-runner.js";
import type { GitProjectBoundary } from "./git-project-boundary.js";

export class GitCandidateQuarantine {
  public constructor(
    private readonly projectRoot: string,
    private readonly git: GitCommandRunner,
    private readonly boundary: GitProjectBoundary,
  ) {}

  public async quarantine(input: {
    runId: string;
    taskId: string;
  }): Promise<CandidateArchive> {
    const referenceKey = createHash("sha256")
      .update(`${input.runId}\0${input.taskId}`)
      .digest("hex")
      .slice(0, 32);
    const reference = `${PRODUCT_IDENTITY.gitReferenceRoot}/quarantine/${referenceKey}`;
    const existingCommit = (
      await this.git.run(["for-each-ref", "--format=%(objectname)", reference])
    ).trim();
    if (existingCommit.length > 0) {
      const archivedFiles = await this.git.nullList([
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
      await this.boundary.clearProjectCandidate();
      return { reference, changedFiles: archivedFiles };
    }

    const changedFiles = await this.boundary.getChangedProjectFiles();
    if (changedFiles.length === 0) {
      return { changedFiles: [] };
    }
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), `${PRODUCT_IDENTITY.slug}-archive-`),
    );
    const environment = {
      ...process.env,
      GIT_INDEX_FILE: join(temporaryRoot, "index"),
    };
    try {
      await this.git.runAt(this.projectRoot, ["read-tree", "HEAD"], environment);
      await this.git.runAt(
        this.projectRoot,
        ["add", "--all", "--", "."],
        environment,
      );
      const tree = (
        await this.git.runAt(this.projectRoot, ["write-tree"], environment)
      ).trim();
      const commit = (
        await this.git.runAt(
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
      await this.git.run(["update-ref", reference, commit]);
      await this.boundary.clearProjectCandidate();
      return { reference, changedFiles };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}
