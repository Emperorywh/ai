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
 * 验证工作区拥有候选源码的隔离副本，门禁只能改变这个副本。
 * 应用层显式决定是否提升变化；释放操作必须清理临时 Git worktree。
 */
export interface VerificationWorkspace {
  readonly projectRoot: string;
  auditChanges(
    task: TaskDefinition,
    protectedPaths: readonly string[],
  ): Promise<ChangeAuditResult>;
  captureCandidate(): Promise<CandidateSnapshot>;
  promoteCandidate(paths: readonly string[]): Promise<void>;
  dispose(): Promise<void>;
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
  openVerificationWorkspace(input: {
    runId: string;
    taskId: string;
    sharedPaths: readonly string[];
    expectedCandidate: CandidateSnapshot;
  }): Promise<VerificationWorkspace>;
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
  }): Promise<string>;
  findTaskCommit(input: {
    runId: string;
    taskId: string;
    expectedParent: string;
    candidateFingerprint: string;
  }): Promise<string | undefined>;
}
