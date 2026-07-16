/*
 * RunState Schema 负责字段形状，语义校验器负责跨字段与线性队列不变量。
 * 恢复和每次持久化前共享同一入口，避免损坏状态在不同应用服务中被局部解释。
 */
import { StateTransitionError } from "./errors.js";
import type { TaskDefinition } from "./project.js";
import type { RunState, TaskRunState } from "./run-state.js";

const ACTIVE_STATUSES = new Set([
  "executing",
  "candidate_pending",
  "reviewing",
  "committing",
  "retry_pending",
]);

export function assertRunStateInvariants(
  state: RunState,
  orderedTasks: readonly TaskDefinition[],
): void {
  const orderedIds = orderedTasks.map((task) => task.id);
  const stateIds = Object.keys(state.tasks);
  if (
    stateIds.length !== orderedIds.length
    || orderedIds.some((taskId) => state.tasks[taskId] === undefined)
  ) {
    throw new StateTransitionError("运行状态的 TASK 集合与当前线性任务目录不一致");
  }

  let firstIncompleteFound = false;
  let activeTasks = 0;
  for (const taskId of orderedIds) {
    const task = state.tasks[taskId];
    if (task === undefined || task.taskId !== taskId) {
      throw new StateTransitionError(`运行状态中的 TASK 身份不一致：${taskId}`);
    }
    assertTaskFields(task);
    if (ACTIVE_STATUSES.has(task.status)) {
      activeTasks += 1;
    }
    if (task.status === "completed") {
      if (firstIncompleteFound) {
        throw new StateTransitionError(`线性队列存在越过未完成前驱的任务：${taskId}`);
      }
      continue;
    }
    if (!firstIncompleteFound) {
      firstIncompleteFound = true;
      continue;
    }
    if (task.status !== "pending") {
      throw new StateTransitionError(`线性队列存在多个已开放任务：${taskId}`);
    }
  }
  if (activeTasks > 1) {
    throw new StateTransitionError("运行状态同时包含多个活动 TASK");
  }

  const tasks = orderedIds.map((taskId) => state.tasks[taskId] as TaskRunState);
  const allCompleted = tasks.every((task) => task.status === "completed");
  if (state.status === "completed" && !allCompleted) {
    throw new StateTransitionError("completed Run 仍包含未完成 TASK");
  }
  if (state.status === "blocked" && !tasks.some((task) => task.status === "blocked")) {
    throw new StateTransitionError("blocked Run 缺少 blocked TASK");
  }
  if (state.status === "failed" && !tasks.some((task) => task.status === "failed")) {
    throw new StateTransitionError("failed Run 缺少 failed TASK");
  }
}

function assertTaskFields(task: TaskRunState): void {
  assertWorkerAttemptHistory(task);
  assertReviewAttemptHistory(task);
  if (
    task.status === "completed"
    && (task.commitSha === undefined || task.completion === undefined)
  ) {
    throw new StateTransitionError(`completed TASK 缺少完成证据：${task.taskId}`);
  }
  if (
    (task.status === "reviewing" || task.status === "committing")
    && task.candidateFingerprint === undefined
  ) {
    throw new StateTransitionError(`${task.status} TASK 缺少候选指纹：${task.taskId}`);
  }
  if (task.status === "retry_pending" && task.retry === undefined) {
    throw new StateTransitionError(`retry_pending TASK 缺少重试上下文：${task.taskId}`);
  }
  if (task.status === "executing") {
    const currentAttempt = task.attempts.at(-1);
    if (currentAttempt === undefined || currentAttempt.finishedAt !== undefined) {
      throw new StateTransitionError(`executing TASK 缺少未结束的 Worker 尝试：${task.taskId}`);
    }
  }
  if (task.status === "candidate_pending") {
    const currentAttempt = task.attempts.at(-1);
    if (
      currentAttempt?.outcome !== "completed"
      || currentAttempt.verifications === undefined
    ) {
      throw new StateTransitionError(
        `candidate_pending TASK 缺少已完成的 Worker 尝试或验证证据：${task.taskId}`,
      );
    }
  }
  if (task.status === "committing") {
    const currentReview = task.reviewAttempts.at(-1);
    if (currentReview?.outcome !== "approved") {
      throw new StateTransitionError(
        `committing TASK 缺少 Reviewer 通过证据：${task.taskId}`,
      );
    }
  }
}

/*
 * 尝试编号与结束字段共同构成可审计时间线：历史项必须结束，只有当前活动阶段可保留未结束尾项。
 * resolvedModel 只能来自可信 init 回调，禁止状态文件构造“未初始化却已解析模型”的矛盾事实。
 */
function assertWorkerAttemptHistory(task: TaskRunState): void {
  task.attempts.forEach((attempt, index) => {
    if (attempt.number !== index + 1) {
      throw new StateTransitionError(`Worker 尝试编号不连续：${task.taskId}`);
    }
    assertAttemptCompletionPair(
      task.taskId,
      "Worker",
      attempt.finishedAt,
      attempt.outcome,
    );
    if (attempt.resolvedModel !== undefined && !attempt.sessionInitialized) {
      throw new StateTransitionError(`Worker 模型事实缺少 init 证据：${task.taskId}`);
    }
    if (index < task.attempts.length - 1 && attempt.finishedAt === undefined) {
      throw new StateTransitionError(`Worker 历史存在未结束尝试：${task.taskId}`);
    }
  });
  const current = task.attempts.at(-1);
  if (
    current !== undefined
    && current.finishedAt === undefined
    && task.status !== "executing"
  ) {
    throw new StateTransitionError(
      `未结束 Worker 尝试与 TASK 阶段不一致：${task.taskId}`,
    );
  }
}

function assertReviewAttemptHistory(task: TaskRunState): void {
  task.reviewAttempts.forEach((attempt, index) => {
    if (attempt.number !== index + 1) {
      throw new StateTransitionError(`Reviewer 尝试编号不连续：${task.taskId}`);
    }
    assertAttemptCompletionPair(
      task.taskId,
      "Reviewer",
      attempt.finishedAt,
      attempt.outcome,
    );
    if (attempt.resolvedModel !== undefined && !attempt.sessionInitialized) {
      throw new StateTransitionError(`Reviewer 模型事实缺少 init 证据：${task.taskId}`);
    }
    if (index < task.reviewAttempts.length - 1 && attempt.finishedAt === undefined) {
      throw new StateTransitionError(`Reviewer 历史存在未结束尝试：${task.taskId}`);
    }
  });
  const current = task.reviewAttempts.at(-1);
  if (
    current !== undefined
    && current.finishedAt === undefined
    && task.status !== "reviewing"
  ) {
    throw new StateTransitionError(
      `未结束 Reviewer 尝试与 TASK 阶段不一致：${task.taskId}`,
    );
  }
}

function assertAttemptCompletionPair(
  taskId: string,
  label: string,
  finishedAt: string | undefined,
  outcome: string | undefined,
): void {
  if ((finishedAt === undefined) !== (outcome === undefined)) {
    throw new StateTransitionError(
      `${label} 尝试结束时间与结果不一致：${taskId}`,
    );
  }
}
