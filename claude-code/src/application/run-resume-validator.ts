/*
 * RunResumeValidator 集中核验项目契约、状态语义和 Git 身份，恢复入口不再散落兼容判断。
 * committing 的唯一例外是提交已成功但状态未落盘，此时只接受精确 trailer 与父提交证据。
 */
import { ConfigurationError } from "../domain/errors.js";
import type { LoadedProject } from "../domain/project.js";
import { assertRunStateInvariants } from "../domain/run-state-invariants.js";
import type { RunState } from "../domain/run-state.js";
import type {
  TaskCommitRecovery,
  WorkspaceIdentityStore,
} from "../ports/workspace.js";

export class RunResumeValidator {
  public constructor(
    private readonly workspace: WorkspaceIdentityStore & TaskCommitRecovery,
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

  public async validateWorkspace(state: RunState): Promise<void> {
    const current = await this.workspace.getIdentity();
    if (current.repositoryRoot !== state.workspace.repositoryRoot) {
      throw new ConfigurationError("Git 仓库身份与运行快照不一致");
    }
    if (current.branch !== state.workspace.branch) {
      throw new ConfigurationError(
        `Git 分支已变化：期望 ${state.workspace.branch}，实际 ${current.branch}`,
      );
    }
    if (current.head === state.workspace.expectedHead) {
      return;
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
      if (recoveredCommit === current.head) {
        return;
      }
    }
    throw new ConfigurationError(
      `Git HEAD 已变化：期望 ${state.workspace.expectedHead}，实际 ${current.head}`,
    );
  }
}
