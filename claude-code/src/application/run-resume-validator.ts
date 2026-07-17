/*
 * RunResumeValidator 集中核验项目契约、状态语义和 Git 身份，恢复入口不再散落兼容判断。
 * 它只开放精确任务提交恢复，以及不改变当前项目树的祖先链快进两种可推导路径。
 */
import { ConfigurationError } from "../domain/errors.js";
import type { LoadedProject } from "../domain/project.js";
import { assertRunStateInvariants } from "../domain/run-state-invariants.js";
import type { RunState } from "../domain/run-state.js";
import type { TaskCommitRecovery } from "../ports/workspace.js";
import type { WorkspaceBaselineResolver } from "./workspace-baseline-resolver.js";

export interface WorkspaceResumeResolution {
  readonly reconciledHead?: string | undefined;
}

export class RunResumeValidator {
  public constructor(
    private readonly workspace: TaskCommitRecovery,
    private readonly baselineResolver: WorkspaceBaselineResolver,
  ) {}

  public validateProjectAndState(
    loaded: LoadedProject,
    state: RunState,
  ): void {
    if (state.projectHash !== loaded.projectHash) {
      throw new ConfigurationError(
        "orchestration/SPEC.md 或 TASK 已变化，不能混用旧运行状态。请创建新运行。",
      );
    }
    if (state.projectRoot !== loaded.projectRoot) {
      throw new ConfigurationError("运行状态所属项目与当前项目不一致");
    }
    assertRunStateInvariants(state, loaded.tasks);
  }

  public async validateWorkspace(
    state: RunState,
  ): Promise<WorkspaceResumeResolution> {
    const resolution = await this.baselineResolver.resolve(state.workspace);
    if (resolution.kind === "unchanged") {
      return {};
    }
    if (resolution.kind === "repository_changed") {
      throw new ConfigurationError("Git 仓库身份与运行快照不一致");
    }
    if (resolution.kind === "branch_changed") {
      throw new ConfigurationError(
        `Git 分支已变化：期望 ${state.workspace.branch}，实际 ${resolution.currentBranch}`,
      );
    }

    const committingTask = Object.values(state.tasks).find(
      (task) => task.status === "committing",
    );
    if (committingTask?.candidateFingerprint !== undefined) {
      const recoveredCommit = await this.workspace.findTaskCommit({
        runId: state.runId,
        taskId: committingTask.taskId,
        expectedParent: state.workspace.expectedHead,
        candidateFingerprint: committingTask.candidateFingerprint,
      });
      if (recoveredCommit === resolution.currentHead) {
        return {};
      }
    }
    if (resolution.kind === "safe_advance") {
      /*
       * 项目外快进不会改变 Worker 候选或 Reviewer 基线，可直接成为新的 expectedHead。
       * QueueOrchestrator 负责在继续任何阶段前 checkpoint 这一事实。
       */
      return { reconciledHead: resolution.currentHead };
    }
    const projectChanges = resolution.changedProjectFiles.length === 0
      ? "HEAD 已回退或分叉"
      : `当前项目已变化：${resolution.changedProjectFiles.join(", ")}`;
    throw new ConfigurationError(
      `Git HEAD 已变化：期望 ${state.workspace.expectedHead}，实际 ${resolution.currentHead}；${projectChanges}`,
    );
  }
}
