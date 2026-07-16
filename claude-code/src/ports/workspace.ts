/*
 * Workspace 端口集中封装 Git 候选、提交和恢复事实，避免应用层散落危险命令。
 * Worker 可修改整个项目；提交仍以项目根为原子边界，不能夹带父仓库兄弟目录。
 */
import type { TaskDefinition } from "../domain/project.js";

export interface WorkspaceIdentity {
  readonly repositoryRoot: string;
  readonly branch: string;
  readonly head: string;
}

export interface CandidateSnapshot {
  readonly fingerprint: string;
  readonly files: readonly CandidateFileSnapshot[];
}

/*
 * ReviewCandidateBundle 只在 Reviewer 启动前构造，避免普通指纹校验反复生成大体积 diff。
 * candidate 仍是唯一身份事实，diff 只是面向审核会话的只读投影。
 */
export interface ReviewCandidateBundle {
  readonly candidate: CandidateSnapshot;
  readonly diff: string;
}

export interface CandidateFileSnapshot {
  readonly path: string;
  readonly kind: "file" | "symlink" | "deleted";
  readonly mode: number;
  readonly contentHash: string;
}

export interface CandidateArchive {
  readonly reference?: string | undefined;
  readonly changedFiles: readonly string[];
}

/*
 * 可复用完成证据来自当前 HEAD 可达的任务提交，Run ID 只用于审计来源。
 * 契约与前驱指纹由应用层提供，Workspace 只负责验证不可伪造的 Git 历史事实。
 */
export interface TaskCompletionEvidence {
  readonly taskId: string;
  readonly commitSha: string;
  readonly runId: string;
  readonly taskContractHash: string;
  readonly predecessorFingerprint: string;
}

/*
 * Git 能力按业务职责拆分，应用服务只依赖自己真正使用的最小端口。
 * Workspace 仅作为默认组合根的聚合门面，不再迫使阶段之间共享巨型基础设施接口。
 */
export interface WorkspaceIdentityStore {
  getStateDirectory(): Promise<string>;
  getIdentity(): Promise<WorkspaceIdentity>;
  assertClean(): Promise<void>;
}

export interface CandidateStore {
  captureCandidate(): Promise<CandidateSnapshot>;
  captureReviewCandidate(): Promise<ReviewCandidateBundle>;
}

export interface CandidateQuarantine {
  quarantineCandidate(input: {
    runId: string;
    taskId: string;
  }): Promise<CandidateArchive>;
}

export interface TaskCommitter {
  commitTask(input: {
    runId: string;
    task: TaskDefinition;
    messagePrefix: string;
    expectedHead: string;
    expectedFingerprint: string;
    taskContractHash: string;
    predecessorFingerprint: string;
  }): Promise<string>;
}

export interface TaskCommitRecovery {
  findTaskCommit(input: {
    runId: string;
    taskId: string;
    expectedParent: string;
    candidateFingerprint: string;
  }): Promise<string | undefined>;
}

export interface TaskCompletionLedger {
  readTaskCompletionHistory(
    head: string,
  ): Promise<readonly TaskCompletionEvidence[]>;
}

export interface Workspace
  extends WorkspaceIdentityStore,
    CandidateStore,
    CandidateQuarantine,
    TaskCommitter,
    TaskCommitRecovery,
    TaskCompletionLedger {}
