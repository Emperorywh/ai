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

/*
 * 释放状态是临时资源生命周期事实，不是门禁通过/失败事实。
 * deferred 必须携带诊断，但调用方仍可持久化门禁结论并推进任务状态机。
 */
export interface VerificationWorkspaceRelease {
  readonly status: "released" | "deferred";
  readonly diagnostics: readonly string[];
}

/*
 * 验证工作区拥有候选源码的隔离副本，门禁只能改变这个副本。
 * 应用层显式决定是否提升变化；释放结果独立于门禁业务结论，操作系统暂时占用文件时
 * 返回 deferred 诊断而不是覆盖已经完成的验证结果。
 */
export interface VerificationWorkspace {
  readonly projectRoot: string;
  auditChanges(
    task: TaskDefinition,
    protectedPaths: readonly string[],
  ): Promise<ChangeAuditResult>;
  captureCandidate(): Promise<CandidateSnapshot>;
  promoteCandidate(paths: readonly string[]): Promise<void>;
  dispose(): Promise<VerificationWorkspaceRelease>;
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
