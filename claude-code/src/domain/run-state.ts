/*
 * 运行状态机是队列事实的唯一写入口，每次转换都验证来源和目标是否合法。
 * 状态使用可读枚举而不是隐式布尔组合，使崩溃恢复路径可以由当前阶段直接推导。
 */
import { StateTransitionError } from "./errors.js";
import {
  verificationEvidenceSchema,
  type VerificationEvidence,
} from "./agent-result.js";
import { z } from "zod";

export const taskStatuses = [
  "pending",
  "executing",
  "candidate_pending",
  "reviewing",
  "committing",
  "retry_pending",
  "completed",
  "blocked",
  "failed",
] as const;

export type TaskStatus = (typeof taskStatuses)[number];
export type RunStatus = "running" | "completed" | "blocked" | "failed";
export type AttemptKind = "implementation" | "repair" | "resume";
export type RetryKind = "repair" | "resume";

export interface TaskAttemptState {
  readonly number: number;
  readonly kind: AttemptKind;
  readonly sessionId: string;
  readonly sessionInitialized: boolean;
  readonly requestedModel: string;
  readonly resolvedModel?: string | undefined;
  readonly startedAt: string;
  readonly finishedAt?: string | undefined;
  readonly outcome?: "completed" | "blocked" | "failed" | "interrupted" | undefined;
  readonly summary?: string | undefined;
  readonly costUsd?: number | undefined;
  readonly turns?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly apiRetryCount?: number | undefined;
  readonly apiRetryDelayMs?: number | undefined;
  readonly toolCalls?: number | undefined;
  readonly verifications?: readonly VerificationEvidence[] | undefined;
}

/*
 * Reviewer 与 Worker 使用同一组资源事实，但拥有独立的生命周期和终态协议。
 * 完整尝试历史替代单一计数器，保证成本、限流和模型漂移都能从状态快照审计。
 */
export interface ReviewAttemptState {
  readonly number: number;
  readonly sessionId: string;
  readonly sessionInitialized: boolean;
  readonly requestedModel: string;
  readonly resolvedModel?: string | undefined;
  readonly startedAt: string;
  readonly finishedAt?: string | undefined;
  readonly outcome?: "approved" | "rejected" | "blocked" | "failed" | "interrupted" | undefined;
  readonly summary?: string | undefined;
  readonly costUsd?: number | undefined;
  readonly turns?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly apiRetryCount?: number | undefined;
  readonly apiRetryDelayMs?: number | undefined;
  readonly toolCalls?: number | undefined;
}

export interface RetryContext {
  readonly kind: RetryKind;
  readonly reason: string;
  readonly feedback: string;
  readonly resumeSessionId?: string | undefined;
}

export interface CandidateArchiveState {
  readonly reference?: string | undefined;
  readonly changedFiles: readonly string[];
  readonly archivedAt: string;
}

/*
 * Worker 阻塞报告不是 TASK 终态证据，只是等待独立 Reviewer 复核的结构化声明。
 * 单独保存摘要与问题，避免从日志文本反向解析，也让崩溃恢复后能重建完全相同的阻塞审计提示词。
 */
export interface WorkerBlockerReport {
  readonly summary: string;
  readonly blockingQuestions: readonly string[];
}

/*
 * 完成证据说明本次 Run 是实际执行了任务，还是复用了 Git 历史中的有效完成提交。
 * 契约与前驱指纹仍以提交 trailer 为项目级事实，本字段只是便于状态展示和运行审计的投影。
 */
export interface TaskCompletionState {
  readonly origin: "executed" | "reused";
  readonly evidenceRunId: string;
  readonly contractHash: string;
  readonly predecessorFingerprint: string;
}

export interface TaskRunState {
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly attempts: readonly TaskAttemptState[];
  readonly retry?: RetryContext | undefined;
  readonly reviewAttempts: readonly ReviewAttemptState[];
  readonly candidateFingerprint?: string | undefined;
  readonly commitSha?: string | undefined;
  readonly completion?: TaskCompletionState | undefined;
  readonly workerBlocker?: WorkerBlockerReport | undefined;
  readonly failureReason?: string | undefined;
  readonly candidateArchive?: CandidateArchiveState | undefined;
  readonly updatedAt: string;
}

export interface RunWorkspaceState {
  readonly repositoryRoot: string;
  readonly branch: string;
  readonly expectedHead: string;
}

export interface RunState {
  readonly version: 6;
  readonly runId: string;
  readonly status: RunStatus;
  readonly projectHash: string;
  readonly projectRoot: string;
  readonly workspace: RunWorkspaceState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly tasks: Readonly<Record<string, TaskRunState>>;
  readonly failureReason?: string | undefined;
}

const taskAttemptStateSchema = z.object({
  number: z.number().int().positive(),
  kind: z.enum(["implementation", "repair", "resume"]),
  sessionId: z.uuid(),
  sessionInitialized: z.boolean(),
  requestedModel: z.string().min(1),
  resolvedModel: z.string().min(1).optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  outcome: z.enum(["completed", "blocked", "failed", "interrupted"]).optional(),
  summary: z.string().optional(),
  costUsd: z.number().nonnegative().optional(),
  turns: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  apiRetryCount: z.number().int().nonnegative().optional(),
  apiRetryDelayMs: z.number().int().nonnegative().optional(),
  toolCalls: z.number().int().nonnegative().optional(),
  verifications: z.array(verificationEvidenceSchema).optional(),
}).strict();

const reviewAttemptStateSchema = z.object({
  number: z.number().int().positive(),
  sessionId: z.uuid(),
  sessionInitialized: z.boolean(),
  requestedModel: z.string().min(1),
  resolvedModel: z.string().min(1).optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  outcome: z.enum([
    "approved",
    "rejected",
    "blocked",
    "failed",
    "interrupted",
  ]).optional(),
  summary: z.string().optional(),
  costUsd: z.number().nonnegative().optional(),
  turns: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  apiRetryCount: z.number().int().nonnegative().optional(),
  apiRetryDelayMs: z.number().int().nonnegative().optional(),
  toolCalls: z.number().int().nonnegative().optional(),
}).strict();

const retryContextSchema = z.object({
  kind: z.enum(["repair", "resume"]),
  reason: z.string(),
  feedback: z.string(),
  resumeSessionId: z.uuid().optional(),
}).strict();

const candidateArchiveStateSchema = z.object({
  reference: z.string().optional(),
  changedFiles: z.array(z.string()),
  archivedAt: z.string(),
}).strict();

/*
 * 该 Schema 与 Worker 结构化输出保持相同的文本上限，防止持久化状态绕过 Agent 结果边界。
 * 它只描述待审核报告，不把 Worker 的单方判断提升为 blocked 运行事实。
 */
const workerBlockerReportSchema = z.object({
  summary: z.string().trim().min(1).max(10_000),
  blockingQuestions: z.array(
    z.string().trim().min(1).max(2_000),
  ).max(50),
}).strict();

const taskCompletionStateSchema = z.object({
  origin: z.enum(["executed", "reused"]),
  evidenceRunId: z.string(),
  contractHash: z.string(),
  predecessorFingerprint: z.string(),
}).strict();

const taskRunStateSchema = z.object({
  taskId: z.string(),
  status: z.enum(taskStatuses),
  attempts: z.array(taskAttemptStateSchema),
  retry: retryContextSchema.optional(),
  reviewAttempts: z.array(reviewAttemptStateSchema),
  candidateFingerprint: z.string().optional(),
  commitSha: z.string().optional(),
  completion: taskCompletionStateSchema.optional(),
  workerBlocker: workerBlockerReportSchema.optional(),
  failureReason: z.string().optional(),
  candidateArchive: candidateArchiveStateSchema.optional(),
  updatedAt: z.string(),
}).strict();

export const runStateSchema: z.ZodType<RunState> = z.object({
  /*
   * 第六版状态增加冻结候选、Reviewer 完整尝试历史和结构化验证证据。
   * 旧状态不补字段也不迁移，恢复路径始终面对当前线性状态图。
   */
  version: z.literal(6),
  runId: z.string(),
  status: z.enum(["running", "completed", "blocked", "failed"]),
  projectHash: z.string(),
  projectRoot: z.string(),
  workspace: z.object({
    repositoryRoot: z.string(),
    branch: z.string(),
    expectedHead: z.string(),
  }).strict(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tasks: z.record(z.string(), taskRunStateSchema),
  failureReason: z.string().optional(),
}).strict();

const allowedTransitions: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ["executing", "blocked", "failed"],
  executing: ["candidate_pending", "retry_pending", "blocked", "failed"],
  candidate_pending: ["reviewing", "blocked", "failed"],
  reviewing: ["reviewing", "committing", "retry_pending", "blocked", "failed"],
  committing: ["completed", "blocked", "failed"],
  retry_pending: ["executing", "blocked", "failed"],
  completed: [],
  blocked: [],
  failed: [],
};

export function createInitialRunState(input: {
  runId: string;
  projectHash: string;
  projectRoot: string;
  workspace: RunWorkspaceState;
  tasks: readonly InitialTaskRunState[];
  now: string;
}): RunState {
  /*
   * 显式构造 Record，避免 Object.fromEntries 把 pending/reused 联合类型退化为 any。
   * 每个初始任务只有两种可推导状态：没有证据时 pending，有核验证据时 completed/reused。
   */
  const tasks: Record<string, TaskRunState> = {};
  for (const task of input.tasks) {
    const shared = {
      taskId: task.taskId,
      attempts: [],
      reviewAttempts: [],
      updatedAt: input.now,
    };
    tasks[task.taskId] = task.reusedCompletion === undefined
      ? { ...shared, status: "pending" }
      : {
          ...shared,
          status: "completed",
          commitSha: task.reusedCompletion.commitSha,
          completion: {
            origin: "reused",
            evidenceRunId: task.reusedCompletion.evidenceRunId,
            contractHash: task.reusedCompletion.contractHash,
            predecessorFingerprint: task.reusedCompletion.predecessorFingerprint,
          },
        };
  }

  return {
    version: 6,
    runId: input.runId,
    status: "running",
    projectHash: input.projectHash,
    projectRoot: input.projectRoot,
    workspace: input.workspace,
    createdAt: input.now,
    updatedAt: input.now,
    tasks,
  };
}

/*
 * 新 Run 的任务种子只接受 pending 或已经由进度协调器核验的复用证据。
 * 领域状态构造器不读取 Git，避免把基础设施判断隐式藏进状态初始化过程。
 */
export interface InitialTaskRunState {
  readonly taskId: string;
  readonly reusedCompletion?: {
    readonly commitSha: string;
    readonly evidenceRunId: string;
    readonly contractHash: string;
    readonly predecessorFingerprint: string;
  } | undefined;
}

export function replaceExpectedHead(
  state: RunState,
  expectedHead: string,
  now: string,
): RunState {
  return {
    ...state,
    updatedAt: now,
    workspace: {
      ...state.workspace,
      expectedHead,
    },
  };
}

/*
 * 只有已由 Reviewer 明确返回 blocked 的终态才能沿原候选重开审核。
 * 该转换原子清除 Run/TASK 失败原因和已消费的归档位置，同时保留全部尝试历史与候选指纹供审计。
 */
export function reopenBlockedReview(
  state: RunState,
  taskId: string,
  candidateFingerprint: string,
  now: string,
): RunState {
  const current = state.tasks[taskId];
  if (state.status !== "blocked" || current?.status !== "blocked") {
    throw new StateTransitionError(`任务 ${taskId} 不是可重开的 blocked 审核`);
  }
  if (
    current.candidateFingerprint === undefined
    || current.reviewAttempts.at(-1)?.outcome !== "blocked"
  ) {
    throw new StateTransitionError(`任务 ${taskId} 缺少 Reviewer 阻塞候选证据`);
  }

  const taskWithoutTerminalFields = { ...current };
  delete taskWithoutTerminalFields.failureReason;
  delete taskWithoutTerminalFields.candidateArchive;
  const stateWithoutFailure = { ...state };
  delete stateWithoutFailure.failureReason;
  return {
    ...stateWithoutFailure,
    status: "running",
    updatedAt: now,
    tasks: {
      ...state.tasks,
      [taskId]: {
        ...taskWithoutTerminalFields,
        status: "reviewing",
        candidateFingerprint,
        updatedAt: now,
      },
    },
  };
}

export function transitionTask(
  state: RunState,
  taskId: string,
  nextStatus: TaskStatus,
  now: string,
  patch: Partial<Omit<TaskRunState, "taskId" | "status" | "updatedAt">> = {},
): RunState {
  const current = state.tasks[taskId];
  if (current === undefined) {
    throw new StateTransitionError(`运行状态中不存在任务 ${taskId}`);
  }
  if (!allowedTransitions[current.status].includes(nextStatus)) {
    throw new StateTransitionError(
      `任务 ${taskId} 不能从 ${current.status} 转换到 ${nextStatus}`,
    );
  }

  const nextTask: TaskRunState = {
    ...current,
    ...patch,
    status: nextStatus,
    updatedAt: now,
  };

  return {
    ...state,
    updatedAt: now,
    tasks: {
      ...state.tasks,
      [taskId]: nextTask,
    },
  };
}

export function replaceCurrentAttempt(
  state: RunState,
  taskId: string,
  attempt: TaskAttemptState,
  now: string,
): RunState {
  const current = state.tasks[taskId];
  if (current === undefined || current.attempts.length === 0) {
    throw new StateTransitionError(`任务 ${taskId} 没有可更新的执行尝试`);
  }

  const attempts = [...current.attempts.slice(0, -1), attempt];
  return {
    ...state,
    updatedAt: now,
    tasks: {
      ...state.tasks,
      [taskId]: {
        ...current,
        attempts,
        updatedAt: now,
      },
    },
  };
}

/*
 * Reviewer 尝试与 Worker 尝试分别维护，二者都通过“只替换最后一次”避免会话回调覆盖历史事实。
 * 调用方必须先追加尝试并 checkpoint，随后才能接受 SDK init 或终态更新。
 */
export function replaceCurrentReviewAttempt(
  state: RunState,
  taskId: string,
  attempt: ReviewAttemptState,
  now: string,
): RunState {
  const current = state.tasks[taskId];
  if (current === undefined || current.reviewAttempts.length === 0) {
    throw new StateTransitionError(`任务 ${taskId} 没有可更新的审核尝试`);
  }
  const reviewAttempts = [
    ...current.reviewAttempts.slice(0, -1),
    attempt,
  ];
  return {
    ...state,
    updatedAt: now,
    tasks: {
      ...state.tasks,
      [taskId]: {
        ...current,
        reviewAttempts,
        updatedAt: now,
      },
    },
  };
}

/*
 * 终态任务仍需追加候选归档等编排元数据，但不能伪造一次状态转换。
 * 该函数只替换非身份字段，状态机的合法性仍由 transitionTask 单独控制。
 */
export function replaceTaskFields(
  state: RunState,
  taskId: string,
  patch: Partial<Omit<TaskRunState, "taskId" | "status" | "updatedAt">>,
  now: string,
): RunState {
  const current = state.tasks[taskId];
  if (current === undefined) {
    throw new StateTransitionError(`运行状态中不存在任务 ${taskId}`);
  }
  return {
    ...state,
    updatedAt: now,
    tasks: {
      ...state.tasks,
      [taskId]: {
        ...current,
        ...patch,
        updatedAt: now,
      },
    },
  };
}

export function finishRun(
  state: RunState,
  status: Exclude<RunStatus, "running">,
  now: string,
  failureReason?: string,
): RunState {
  return {
    ...state,
    status,
    updatedAt: now,
    ...(failureReason === undefined ? {} : { failureReason }),
  };
}
