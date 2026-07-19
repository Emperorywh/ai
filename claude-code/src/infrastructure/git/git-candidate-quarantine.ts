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

const QUARANTINE_REFERENCE_PREFIX = `${PRODUCT_IDENTITY.gitReferenceRoot}/quarantine/`;

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

  /*
   * 恢复只接受本产品 quarantine 命名空间中的引用，并只写当前项目 pathspec。
   * 先同时恢复索引与工作树以覆盖归档中的新增/删除文件，再把索引重置到 HEAD，保持正常未暂存候选语义。
   */
  public async restore(reference: string): Promise<void> {
    this.assertQuarantineReference(reference);
    const archivedCommit = (
      await this.git.run(["for-each-ref", "--format=%(objectname)", reference])
    ).trim();
    if (archivedCommit.length === 0) {
      throw new Error(`找不到终态候选隔离引用：${reference}`);
    }
    await this.git.run([
      "restore",
      `--source=${reference}`,
      "--staged",
      "--worktree",
      "--",
      ".",
    ]);
    await this.normalizeIndex();
  }

  /*
   * 若进程恰好在文件恢复后、索引归一化前中断，下一次 resume 会看到同指纹候选。
   * 独立的幂等归一化入口确保该崩溃窗口不会把暂存状态泄漏给后续审核或提交阶段。
   */
  public async normalizeIndex(): Promise<void> {
    await this.git.run([
      "restore",
      "--source=HEAD",
      "--staged",
      "--",
      ".",
    ]);
  }

  /*
   * 候选已经回到受指纹保护的工作区后，旧隔离引用必须被消费。
   * 同一 Run/TASK 若再次阻塞，归档器即可用确定性引用保存最新候选，而不会误用旧快照。
   */
  public async consume(reference: string): Promise<void> {
    this.assertQuarantineReference(reference);
    await this.git.run(["update-ref", "-d", reference]);
  }

  private assertQuarantineReference(reference: string): void {
    if (!reference.startsWith(QUARANTINE_REFERENCE_PREFIX)) {
      throw new Error(`拒绝恢复非 Apex 隔离引用：${reference}`);
    }
  }
}
