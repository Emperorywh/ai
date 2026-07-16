/*
 * TaskExecutionService 只根据持久化 TASK 状态分派到单一阶段，不持有阶段实现细节。
 * Implementation、Review、Commit 各自高内聚，队列与 checkpoint 仍由 QueueOrchestrator 统一拥有。
 */
import type { TaskRunState } from "../domain/run-state.js";
import type { CommitStage } from "./commit-stage.js";
import type { ImplementationStage } from "./implementation-stage.js";
import type { ReviewStage } from "./review-stage.js";
import type {
  TaskStepInput,
  TaskStepResult,
} from "./task-execution-contract.js";

export type {
  TaskStepInput,
  TaskStepResult,
} from "./task-execution-contract.js";

export class TaskExecutionService {
  public constructor(
    private readonly implementation: ImplementationStage,
    private readonly review: ReviewStage,
    private readonly commit: CommitStage,
  ) {}

  public async step(input: TaskStepInput): Promise<TaskStepResult> {
    const taskState = input.state.tasks[input.task.id];
    if (taskState === undefined) {
      throw new Error(`运行状态中不存在任务 ${input.task.id}`);
    }
    if (isImplementationStatus(taskState)) {
      return this.implementation.step(input, taskState);
    }
    if (taskState.status === "reviewing") {
      return this.review.step(input, taskState);
    }
    if (taskState.status === "committing") {
      return this.commit.step(input);
    }
    return {
      state: input.state,
      message: `任务已处于终态 ${taskState.status}`,
    };
  }
}

function isImplementationStatus(task: TaskRunState): boolean {
  return task.status === "pending"
    || task.status === "retry_pending"
    || task.status === "executing"
    || task.status === "candidate_pending";
}
