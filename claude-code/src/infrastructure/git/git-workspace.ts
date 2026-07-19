/*
 * GitWorkspace 是默认组合根使用的薄门面，只装配并转发相互独立的 Git 组件。
 * 应用层依赖职责化端口；门面保留统一实例生命周期，但不再承载候选、账本或隔离算法。
 */
import { CandidateChangedError } from "../../domain/errors.js";
import type { TaskDefinition } from "../../domain/project.js";
import type {
  CandidateArchive,
  CandidateSnapshot,
  ReviewCandidateBundle,
  TaskCompletionEvidence,
  Workspace,
  WorkspaceHeadAdvance,
  WorkspaceIdentity,
} from "../../ports/workspace.js";
import { GitCandidateQuarantine } from "./git-candidate-quarantine.js";
import { GitCandidateStore } from "./git-candidate-store.js";
import { GitCommandRunner } from "./git-command-runner.js";
import { GitProjectBoundary } from "./git-project-boundary.js";
import { GitTaskCompletionLedger } from "./git-task-completion-ledger.js";

export class GitWorkspace implements Workspace {
  private readonly boundary: GitProjectBoundary;
  private readonly candidates: GitCandidateStore;
  private readonly quarantine: GitCandidateQuarantine;
  private readonly ledger: GitTaskCompletionLedger;

  public constructor(projectRoot: string) {
    const git = new GitCommandRunner(projectRoot);
    this.boundary = new GitProjectBoundary(projectRoot, git);
    this.candidates = new GitCandidateStore(projectRoot, git, this.boundary);
    this.quarantine = new GitCandidateQuarantine(projectRoot, git, this.boundary);
    this.ledger = new GitTaskCompletionLedger(git, this.boundary);
  }

  public getStateDirectory(): Promise<string> {
    return this.boundary.getStateDirectory();
  }

  public getLockDirectory(): Promise<string> {
    return this.boundary.getLockDirectory();
  }

  public getIdentity(): Promise<WorkspaceIdentity> {
    return this.boundary.getIdentity();
  }

  public assertClean(): Promise<void> {
    return this.boundary.assertClean();
  }

  public inspectHeadAdvance(input: {
    expectedHead: string;
    currentHead: string;
  }): Promise<WorkspaceHeadAdvance> {
    return this.boundary.inspectHeadAdvance(input);
  }

  public captureCandidate(): Promise<CandidateSnapshot> {
    return this.candidates.captureCandidate();
  }

  public captureReviewCandidate(): Promise<ReviewCandidateBundle> {
    return this.candidates.captureReviewCandidate();
  }

  public quarantineCandidate(input: {
    runId: string;
    taskId: string;
  }): Promise<CandidateArchive> {
    return this.quarantine.quarantine(input);
  }

  /*
   * blocked 恢复可能在“恢复文件、消费引用、写 checkpoint”任一点崩溃，因此该操作必须可重入。
   * 工作区已有完全相同的冻结候选时直接沿用；存在其他改动时拒绝覆盖，避免吞掉人工修改。
   */
  public async restoreCandidate(input: {
    reference?: string | undefined;
    expectedFingerprint: string;
  }): Promise<string> {
    const current = await this.candidates.captureCandidate();
    if (current.files.length > 0) {
      if (current.fingerprint !== input.expectedFingerprint) {
        throw new CandidateChangedError(
          "恢复终态候选前工作区存在其他改动，拒绝覆盖",
        );
      }
      await this.quarantine.normalizeIndex();
      return current.fingerprint;
    } else if (input.reference !== undefined) {
      await this.quarantine.restore(input.reference);
    }

    const restored = await this.candidates.captureCandidate();
    if (input.reference === undefined && restored.fingerprint !== input.expectedFingerprint) {
      throw new CandidateChangedError(
        `终态隔离候选恢复后的内容指纹与原审核候选不一致：期望 ${input.expectedFingerprint}，实际 ${restored.fingerprint}；恢复文件 ${restored.files.map((file) => `${file.path}:${file.mode}:${file.contentHash}`).join(", ") || "<空>"}`,
      );
    }
    return restored.fingerprint;
  }

  /*
   * 隔离引用必须等“新候选指纹 + reviewing 状态”成功 checkpoint 后才能消费。
   * 该顺序确保状态落盘失败时旧引用仍可作为恢复源，不会只剩无法证明来源的工作区文件。
   */
  public async consumeCandidateArchive(reference: string): Promise<void> {
    await this.quarantine.consume(reference);
  }

  public commitTask(input: {
    runId: string;
    task: TaskDefinition;
    messagePrefix: string;
    expectedHead: string;
    expectedFingerprint: string;
    taskContractHash: string;
    predecessorFingerprint: string;
  }): Promise<string> {
    return this.candidates.commitTask(input);
  }

  public findTaskCommit(input: {
    runId: string;
    taskId: string;
    expectedParent: string;
    candidateFingerprint: string;
  }): Promise<string | undefined> {
    return this.ledger.findTaskCommit(input);
  }

  public readTaskCompletionHistory(
    head: string,
  ): Promise<readonly TaskCompletionEvidence[]> {
    return this.ledger.readHistory(head);
  }
}
