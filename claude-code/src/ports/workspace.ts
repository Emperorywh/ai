/*
 * Workspace 端口集中封装 Git 候选、提交和恢复事实，避免应用层散落危险命令。
 * Worker 可修改整个项目；提交仍以项目根为原子边界，不能夹带父仓库兄弟目录。
 */
import type { TaskDefinition } from "../domain/manifest.js";

export interface WorkspaceIdentity {
  readonly repositoryRoot: string;
  readonly branch: string;
  readonly head: string;
}

export interface CandidateSnapshot {
  readonly fingerprint: string;
  readonly diff: string;
  readonly files: readonly CandidateFileSnapshot[];
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
 * 契约与依赖指纹由应用层提供，Workspace 只负责验证不可伪造的 Git 历史事实。
 */
export interface TaskCompletionEvidence {
  readonly taskId: string;
  readonly commitSha: string;
  readonly runId: string;
  readonly taskContractHash: string;
  readonly dependencyFingerprint: string;
}

export interface Workspace {
  getStateDirectory(): Promise<string>;
  getIdentity(): Promise<WorkspaceIdentity>;
  assertClean(): Promise<void>;
  captureCandidate(): Promise<CandidateSnapshot>;
  quarantineCandidate(input: {
    runId: string;
    taskId: string;
  }): Promise<CandidateArchive>;
  commitTask(input: {
    runId: string;
    task: TaskDefinition;
    messagePrefix: string;
    expectedHead: string;
    expectedFingerprint: string;
    taskContractHash: string;
    dependencyFingerprint: string;
  }): Promise<string>;
  findTaskCommit(input: {
    runId: string;
    taskId: string;
    expectedParent: string;
    candidateFingerprint: string;
  }): Promise<string | undefined>;
  readTaskCompletionHistory(
    head: string,
  ): Promise<readonly TaskCompletionEvidence[]>;
}
