/*
 * GitWorkspace 是默认组合根使用的薄门面，只装配并转发相互独立的 Git 组件。
 * 应用层依赖职责化端口；门面保留统一实例生命周期，但不再承载候选、账本或隔离算法。
 */
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
