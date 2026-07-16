/*
 * CommitStage 只负责将已审核候选绑定到任务契约、前驱证据和原子 Git 提交。
 * 候选变化收敛为 blocked，其他基础设施故障保持异常语义，不在本阶段静默降级。
 */
import { CandidateChangedError } from "../domain/errors.js";
import {
  replaceExpectedHead,
  transitionTask,
  type TaskCompletionState,
} from "../domain/run-state.js";
import { createPredecessorCompletionFingerprint } from "../domain/task-completion.js";
import { findTaskPredecessor } from "../domain/task-sequence.js";
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

export class CommitStage {
  public constructor(
    private readonly workspace: TaskCommitter
      & TaskCommitRecovery
      & Pick<WorkspaceIdentityStore, "assertClean">,
    private readonly support: TaskStageSupport,
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

    let commitSha: string;
    try {
      commitSha = await this.workspace.commitTask({
        runId: input.state.runId,
        task: input.task,
        messagePrefix: ORCHESTRATOR_POLICY.git.commitMessagePrefix,
        expectedHead: input.state.workspace.expectedHead,
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
      input.state,
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
