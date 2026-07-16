/*
 * 运行状态展示投影显式列出全部时间字段，不通过键名猜测或递归字符串替换制造魔法行为。
 * 返回值只用于 CLI 输出，原 RunState 及持久化快照始终保持规范 UTC 时间事实。
 */
import type { RunState, TaskRunState } from "../domain/run-state.js";
import type { TimeFormatter } from "../ports/time-formatter.js";

export function presentRunState(
  state: RunState,
  timeFormatter: TimeFormatter,
): RunState {
  return {
    ...state,
    createdAt: timeFormatter.formatTimestamp(state.createdAt),
    updatedAt: timeFormatter.formatTimestamp(state.updatedAt),
    tasks: Object.fromEntries(
      Object.entries(state.tasks).map(([taskId, task]) => [
        taskId,
        presentTaskState(task, timeFormatter),
      ]),
    ),
  };
}

function presentTaskState(
  task: TaskRunState,
  timeFormatter: TimeFormatter,
): TaskRunState {
  return {
    ...task,
    updatedAt: timeFormatter.formatTimestamp(task.updatedAt),
    attempts: task.attempts.map((attempt) => ({
      ...attempt,
      startedAt: timeFormatter.formatTimestamp(attempt.startedAt),
      ...(attempt.finishedAt === undefined
        ? {}
        : { finishedAt: timeFormatter.formatTimestamp(attempt.finishedAt) }),
    })),
    reviewAttempts: task.reviewAttempts.map((attempt) => ({
      ...attempt,
      startedAt: timeFormatter.formatTimestamp(attempt.startedAt),
      ...(attempt.finishedAt === undefined
        ? {}
        : { finishedAt: timeFormatter.formatTimestamp(attempt.finishedAt) }),
    })),
    /*
     * RunState v6 显式投影 Worker、Reviewer 与候选归档时间；验证证据本身不含时间字段。
     * 显式字段映射继续保证展示层不会递归猜测任意字符串的时间语义。
     */
    ...(task.candidateArchive === undefined
      ? {}
      : {
          candidateArchive: {
            ...task.candidateArchive,
            archivedAt: timeFormatter.formatTimestamp(
              task.candidateArchive.archivedAt,
            ),
          },
        }),
  };
}
