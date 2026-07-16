/*
 * RunFinalizer 只把严格线性任务状态归约为 Run 终态，不执行 I/O。
 * pending 后继不参与失败计数；唯一队首终态决定 blocked 或 failed，全部完成才得到 completed。
 */
import { ConfigurationError } from "../domain/errors.js";
import type { TaskDefinition } from "../domain/project.js";
import { finishRun, type RunState } from "../domain/run-state.js";

export interface RunFinalization {
  readonly state: RunState;
  readonly terminalStatus: "blocked" | "completed" | "failed";
  readonly message: string;
}

export class RunFinalizer {
  public finalize(
    state: RunState,
    orderedTasks: readonly TaskDefinition[],
    now: string,
  ): RunFinalization {
    const allCompleted = orderedTasks.every(
      (task) => state.tasks[task.id]?.status === "completed",
    );
    const terminalTask = orderedTasks
      .map((task) => state.tasks[task.id])
      .find((taskState) =>
        taskState?.status === "blocked" || taskState?.status === "failed");
    if (!allCompleted && terminalTask === undefined) {
      throw new ConfigurationError("线性队列没有可执行任务，也没有可解释的终态任务");
    }
    const terminalStatus = allCompleted
      ? "completed" as const
      : terminalTask?.status === "failed"
        ? "failed" as const
        : "blocked" as const;
    const failureReason = allCompleted
      ? undefined
      : `${terminalTask?.taskId ?? "unknown"}: ${terminalTask?.failureReason ?? terminalStatus}`;
    return {
      state: finishRun(state, terminalStatus, now, failureReason),
      terminalStatus,
      message: allCompleted ? "全部任务完成" : failureReason ?? terminalStatus,
    };
  }
}
