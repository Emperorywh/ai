/*
 * 运行状态机是队列事实的唯一写入口，每次转换都验证来源和目标是否合法。
 * 状态使用可读枚举而不是隐式布尔组合，使崩溃恢复路径可以由当前阶段直接推导。
 */
import { StateTransitionError } from "./errors.js";
import { z } from "zod";

export const taskStatuses = [
  "pending",
  "executing",
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

export interface CandidateArchiveState {
  readonly reference?: string | undefined;
  readonly changedFiles: readonly string[];
  readonly archivedAt: string;
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
  readonly reviewAttempts: number;
  readonly candidateFingerprint?: string | undefined;
  readonly reviewSessionId?: string | undefined;
  readonly reviewSummary?: string | undefined;
  readonly commitSha?: string | undefined;
  readonly completion?: TaskCompletionState | undefined;
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
  readonly version: 5;
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

const candidateArchiveStateSchema = z.object({
  reference: z.string().optional(),
  changedFiles: z.array(z.string()),
  archivedAt: z.string(),
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
  reviewAttempts: z.number().int().nonnegative(),
  candidateFingerprint: z.string().optional(),
  reviewSessionId: z.uuid().optional(),
  reviewSummary: z.string().optional(),
  commitSha: z.string().optional(),
  completion: taskCompletionStateSchema.optional(),
  failureReason: z.string().optional(),
  candidateArchive: candidateArchiveStateSchema.optional(),
  updatedAt: z.string(),
}).strict();

export const runStateSchema: z.ZodType<RunState> = z.object({
  /*
   * 第五版状态删除 DAG 依赖终态，并把完成关系收敛为唯一前驱指纹。
   * 旧状态不补字段也不迁移，恢复路径始终面对当前线性状态图。
   */
  version: z.literal(5),
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
  executing: ["reviewing", "committing", "retry_pending", "blocked", "failed"],
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
      reviewAttempts: 0,
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
    version: 5,
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
