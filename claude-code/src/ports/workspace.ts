/*
 * Workspace 端口集中封装 Git 与文件变更边界，避免应用层散落危险命令。
 * 所有路径都以项目根为基准，提交操作不得包含父仓库中的兄弟目录。
 */
import type { TaskDefinition } from "../domain/manifest.js";

export interface ChangeAuditResult {
  readonly changedFiles: readonly string[];
  readonly violations: readonly string[];
}

export interface WorkspaceIdentity {
  readonly repositoryRoot: string;
  readonly branch: string;
  readonly head: string;
}

export interface CandidateSnapshot {
  readonly fingerprint: string;
  readonly diff: string;
}

export interface Workspace {
  getStateDirectory(): Promise<string>;
  getIdentity(): Promise<WorkspaceIdentity>;
  assertClean(): Promise<void>;
  auditChanges(
    task: TaskDefinition,
    protectedPaths: readonly string[],
  ): Promise<ChangeAuditResult>;
  captureCandidate(): Promise<CandidateSnapshot>;
  commitTask(input: {
    runId: string;
    task: TaskDefinition;
    messagePrefix: string;
    expectedHead: string;
    expectedFingerprint: string;
  }): Promise<string>;
  findTaskCommit(input: {
    runId: string;
    taskId: string;
    expectedParent: string;
    candidateFingerprint: string;
  }): Promise<string | undefined>;
}
