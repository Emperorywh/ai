/*
 * 运行状态机是队列事实的唯一写入口，每次转换都验证来源和目标是否合法。
 * 状态使用可读枚举而不是隐式布尔组合，使崩溃恢复路径可以由当前阶段直接推导。
 */
import { StateTransitionError } from "./errors.js";
import { z } from "zod";

export const taskStatuses = [
  "pending",
  "executing",
  "gating",
  "reviewing",
  "committing",
  "retry_pending",
  "completed",
  "blocked",
  "failed",
  "dependency_blocked",
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
  readonly startedAt: string;
  readonly finishedAt?: string | undefined;
  readonly outcome?: "completed" | "blocked" | "failed" | undefined;
  readonly summary?: string | undefined;
  readonly costUsd?: number | undefined;
  readonly turns?: number | undefined;
}

export interface RetryContext {
  readonly kind: RetryKind;
  readonly reason: string;
  readonly feedback: string;
  readonly resumeSessionId?: string | undefined;
}

export interface GateExecutionState {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface GateRunState {
  readonly number: number;
  readonly candidateBefore: string;
  readonly candidateAfter: string;
  readonly results: readonly GateExecutionState[];
  readonly mutatedFiles: readonly string[];
  readonly outcome: "passed" | "failed" | "mutated" | "boundary_violation";
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface CandidateArchiveState {
  readonly reference?: string | undefined;
  readonly changedFiles: readonly string[];
  readonly archivedAt: string;
}

export interface TaskRunState {
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly attempts: readonly TaskAttemptState[];
  readonly retry?: RetryContext | undefined;
  readonly gateRuns: readonly GateRunState[];
  readonly reviewAttempts: number;
  readonly candidateFingerprint?: string | undefined;
  readonly reviewSessionId?: string | undefined;
  readonly reviewSummary?: string | undefined;
  readonly commitSha?: string | undefined;
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
  readonly version: 2;
  readonly runId: string;
  readonly status: RunStatus;
  readonly manifestPath: string;
  readonly manifestHash: string;
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
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  outcome: z.enum(["completed", "blocked", "failed"]).optional(),
  summary: z.string().optional(),
  costUsd: z.number().nonnegative().optional(),
  turns: z.number().int().nonnegative().optional(),
}).strict();

const retryContextSchema = z.object({
  kind: z.enum(["repair", "resume"]),
  reason: z.string(),
  feedback: z.string(),
  resumeSessionId: z.uuid().optional(),
}).strict();

const gateExecutionStateSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().nonnegative(),
}).strict();

const gateRunStateSchema = z.object({
  number: z.number().int().positive(),
  candidateBefore: z.string(),
  candidateAfter: z.string(),
  results: z.array(gateExecutionStateSchema),
  mutatedFiles: z.array(z.string()),
  outcome: z.enum(["passed", "failed", "mutated", "boundary_violation"]),
  startedAt: z.string(),
  finishedAt: z.string(),
}).strict();

const candidateArchiveStateSchema = z.object({
  reference: z.string().optional(),
  changedFiles: z.array(z.string()),
  archivedAt: z.string(),
}).strict();

const taskRunStateSchema = z.object({
  taskId: z.string(),
  status: z.enum(taskStatuses),
  attempts: z.array(taskAttemptStateSchema),
  retry: retryContextSchema.optional(),
  gateRuns: z.array(gateRunStateSchema),
  reviewAttempts: z.number().int().nonnegative(),
  candidateFingerprint: z.string().optional(),
  reviewSessionId: z.uuid().optional(),
  reviewSummary: z.string().optional(),
  commitSha: z.string().optional(),
  failureReason: z.string().optional(),
  candidateArchive: candidateArchiveStateSchema.optional(),
  updatedAt: z.string(),
}).strict();

export const runStateSchema: z.ZodType<RunState> = z.object({
  version: z.literal(2),
  runId: z.string(),
  status: z.enum(["running", "completed", "blocked", "failed"]),
  manifestPath: z.string(),
  manifestHash: z.string(),
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
  pending: ["executing", "blocked", "failed", "dependency_blocked"],
  executing: ["gating", "retry_pending", "blocked", "failed"],
  gating: ["reviewing", "committing", "retry_pending", "blocked", "failed"],
  reviewing: ["reviewing", "committing", "retry_pending", "blocked", "failed"],
  committing: ["completed", "blocked", "failed"],
  retry_pending: ["executing", "blocked", "failed"],
  completed: [],
  blocked: [],
  failed: [],
  dependency_blocked: [],
};

export function createInitialRunState(input: {
  runId: string;
  manifestPath: string;
  manifestHash: string;
  projectRoot: string;
  workspace: RunWorkspaceState;
  taskIds: readonly string[];
  now: string;
}): RunState {
  const tasks = Object.fromEntries(
    input.taskIds.map((taskId) => [
      taskId,
      {
        taskId,
        status: "pending" as const,
        attempts: [],
        gateRuns: [],
        reviewAttempts: 0,
        updatedAt: input.now,
      },
    ]),
  );

  return {
    version: 2,
    runId: input.runId,
    status: "running",
    manifestPath: input.manifestPath,
    manifestHash: input.manifestHash,
    projectRoot: input.projectRoot,
    workspace: input.workspace,
    createdAt: input.now,
    updatedAt: input.now,
    tasks,
  };
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
