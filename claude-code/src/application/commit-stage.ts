/*
 * CommitStage 只负责协调已审核候选的提交基线，并绑定任务契约、前驱证据和原子 Git 提交。
 * 候选变化收敛为 blocked；不安全的基线变化和其他基础设施故障保持异常语义。
 */
import {
  CandidateChangedError,
  InfrastructureError,
} from "../domain/errors.js";
import {
  replaceExpectedHead,
  transitionTask,
  type TaskCompletionState,
} from "../domain/run-state.js";
import { createPredecessorCompletionFingerprint } from "../domain/task-completion.js";
import { findTaskPredecessor } from "../domain/task-sequence.js";
import type { CanonicalHashService } from "../ports/canonical-hash.js";
import type {
  TaskCommitRecovery,
  TaskCommitter,
  WorkspaceIdentityStore,
} from "../ports/workspace.js";
import { ORCHESTRATOR_POLICY } from "./orchestrator-policy.js";
import type {
  TaskStepInput,
  TaskStepResult,
} from "./task-execution-contract.js";
import type { TaskStageSupport } from "./task-stage-support.js";
import type {
  WorkspaceBaselineResolution,
  WorkspaceBaselineResolver,
} from "./workspace-baseline-resolver.js";

export class CommitStage {
  public constructor(
    private readonly workspace: TaskCommitter
      & TaskCommitRecovery
      & Pick<WorkspaceIdentityStore, "assertClean">,
    private readonly support: TaskStageSupport,
    private readonly baselineResolver: WorkspaceBaselineResolver,
    private readonly canonicalHash: CanonicalHashService,
  ) {}

  public async step(input: TaskStepInput): Promise<TaskStepResult> {
    const taskState = input.state.tasks[input.task.id];
    if (taskState?.candidateFingerprint === undefined) {
      return this.support.block(input, "提交阶段缺少实现候选指纹");
    }
    const completion = this.createCompletionState(input);
    const existingCommit = await this.workspace.findTaskCommit({
      runId: input.state.runId,
      taskId: input.task.id,
      expectedParent: input.state.workspace.expectedHead,
      candidateFingerprint: taskState.candidateFingerprint,
    });
    if (existingCommit !== undefined) {
      await this.workspace.assertClean();
      const completed = transitionTask(
        input.state,
        input.task.id,
        "completed",
        this.support.now(),
        { commitSha: existingCommit, completion },
      );
      return {
        state: replaceExpectedHead(completed, existingCommit, this.support.now()),
        message: `检测到已完成提交 ${existingCommit}，恢复为 completed`,
      };
    }

    const state = await this.reconcileExpectedHead(input);

    let commitSha: string;
    try {
      commitSha = await this.workspace.commitTask({
        runId: input.state.runId,
        task: input.task,
        messagePrefix: ORCHESTRATOR_POLICY.git.commitMessagePrefix,
        expectedHead: state.workspace.expectedHead,
        expectedFingerprint: taskState.candidateFingerprint,
        taskContractHash: completion.contractHash,
        predecessorFingerprint: completion.predecessorFingerprint,
      });
    } catch (error) {
      if (error instanceof CandidateChangedError) {
        return this.support.block(input, error.message);
      }
      throw error;
    }
    const completed = transitionTask(
      state,
      input.task.id,
      "completed",
      this.support.now(),
      { commitSha, completion },
    );
    return {
      state: replaceExpectedHead(completed, commitSha, this.support.now()),
      message: `任务已提交：${commitSha}`,
    };
  }

  private async reconcileExpectedHead(
    input: TaskStepInput,
  ): Promise<TaskStepInput["state"]> {
    const resolution = await this.baselineResolver.resolve(
      input.state.workspace,
    );
    if (resolution.kind === "unchanged") {
      return input.state;
    }
    if (resolution.kind === "safe_advance") {
      const state = replaceExpectedHead(
        input.state,
        resolution.currentHead,
        this.support.now(),
      );
      /*
       * 新基线必须先于 Git commit 落盘；若进程随后崩溃，恢复逻辑才能用精确父提交查找任务提交。
       * onCheckpoint 仍由 QueueOrchestrator 实现，CommitStage 不直接依赖持久化或事件日志。
       */
      await input.onCheckpoint?.(
        state,
        `检测到仅影响项目外的 HEAD 快进，提交基线已前移至 ${resolution.currentHead}`,
        {
          previousExpectedHead: input.state.workspace.expectedHead,
          reconciledExpectedHead: resolution.currentHead,
        },
      );
      return state;
    }
    throw new InfrastructureError(
      this.describeBaselineConflict(input, resolution),
    );
  }

  private describeBaselineConflict(
    input: TaskStepInput,
    resolution: Exclude<
      WorkspaceBaselineResolution,
      { readonly kind: "unchanged" | "safe_advance" }
    >,
  ): string {
    if (resolution.kind === "repository_changed") {
      return "提交前 Git 仓库身份已变化";
    }
    if (resolution.kind === "branch_changed") {
      return `提交前 Git 分支已变化：期望 ${input.state.workspace.branch}，实际 ${resolution.currentBranch}`;
    }
    const projectChanges = resolution.changedProjectFiles.length === 0
      ? "HEAD 已回退或分叉"
      : `当前项目已变化：${resolution.changedProjectFiles.join(", ")}`;
    return `提交前 HEAD 无法安全前移：期望 ${input.state.workspace.expectedHead}，实际 ${resolution.currentHead}；${projectChanges}`;
  }

  private createCompletionState(input: TaskStepInput): TaskCompletionState {
    const contractHash = input.loaded.taskContractHashes.get(input.task.id);
    if (contractHash === undefined) {
      throw new Error(`任务缺少完成契约指纹：${input.task.id}`);
    }
    const predecessor = findTaskPredecessor(input.loaded.tasks, input.task.id);
    const predecessorCompletion = predecessor === undefined
      ? undefined
      : {
          taskId: predecessor.id,
          commitSha: this.requireCompletedTaskCommit(input, predecessor.id),
        };
    return {
      origin: "executed",
      evidenceRunId: input.state.runId,
      contractHash,
      predecessorFingerprint: createPredecessorCompletionFingerprint(
        predecessorCompletion,
        this.canonicalHash,
      ),
    };
  }

  private requireCompletedTaskCommit(
    input: TaskStepInput,
    taskId: string,
  ): string {
    const taskState = input.state.tasks[taskId];
    if (taskState?.status !== "completed" || taskState.commitSha === undefined) {
      throw new Error(`前驱任务缺少完成提交：${taskId}`);
    }
    return taskState.commitSha;
  }
}
