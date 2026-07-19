/*
 * 语义不变量测试构造字段形状合法但跨字段矛盾的状态，确保恢复入口会在 Agent 启动前拒绝损坏快照。
 * 重点覆盖线性前缀、活动候选、尝试时间线和 Reviewer 提交证据，而非重复 Zod 字段测试。
 */
import { describe, expect, it } from "vitest";
import { taskDefinitionSchema } from "../src/domain/project.js";
import { createInitialRunState, type RunState } from "../src/domain/run-state.js";
import { assertRunStateInvariants } from "../src/domain/run-state-invariants.js";

const tasks = ["TASK-001", "TASK-002"].map((id) =>
  taskDefinitionSchema.parse({ id, title: id, file: `orchestration/tasks/${id}.md` }));

describe("assertRunStateInvariants", () => {
  it("拒绝越过未完成前驱的 completed 任务", () => {
    const state = createState();
    const damaged: RunState = {
      ...state,
      tasks: {
        ...state.tasks,
        "TASK-002": completedTask(state.tasks["TASK-002"]),
      },
    };

    expect(() => assertRunStateInvariants(damaged, tasks)).toThrow(
      "越过未完成前驱",
    );
  });

  it("拒绝没有完成 Worker 尝试的候选冻结阶段", () => {
    const state = createState();
    const current = requireTask(state, "TASK-001");
    const damaged: RunState = {
      ...state,
      tasks: {
        ...state.tasks,
        "TASK-001": { ...current, status: "candidate_pending" },
      },
    };

    expect(() => assertRunStateInvariants(damaged, tasks)).toThrow(
      "缺少已完成候选或待审计 Worker 阻塞报告",
    );
  });

  it("拒绝没有 Reviewer 通过证据的 committing 状态", () => {
    const state = createState();
    const current = requireTask(state, "TASK-001");
    const damaged: RunState = {
      ...state,
      tasks: {
        ...state.tasks,
        "TASK-001": {
          ...current,
          status: "committing",
          candidateFingerprint: "candidate",
        },
      },
    };

    expect(() => assertRunStateInvariants(damaged, tasks)).toThrow(
      "缺少 Reviewer 通过证据",
    );
  });

  it("拒绝结束时间与结果不成对的尝试", () => {
    const state = createState();
    const current = requireTask(state, "TASK-001");
    const damaged: RunState = {
      ...state,
      tasks: {
        ...state.tasks,
        "TASK-001": {
          ...current,
          status: "executing",
          attempts: [{
            number: 1,
            kind: "implementation",
            sessionId: "11111111-1111-4111-8111-111111111111",
            sessionInitialized: false,
            requestedModel: "claude-sonnet-5",
            startedAt: state.createdAt,
            outcome: "failed",
          }],
        },
      },
    };

    expect(() => assertRunStateInvariants(damaged, tasks)).toThrow(
      "结束时间与结果不一致",
    );
  });
});

function createState(): RunState {
  return createInitialRunState({
    runId: "run-test",
    projectHash: "project-hash",
    projectRoot: "/project",
    workspace: {
      repositoryRoot: "/project",
      branch: "main",
      expectedHead: "base",
    },
    tasks: tasks.map((task) => ({ taskId: task.id })),
    now: "2026-07-16T00:00:00.000Z",
  });
}

function completedTask(task: RunState["tasks"][string] | undefined) {
  if (task === undefined) {
    throw new Error("测试状态缺少任务");
  }
  return {
    ...task,
    status: "completed" as const,
    commitSha: "commit",
    completion: {
      origin: "reused" as const,
      evidenceRunId: "old-run",
      contractHash: "contract",
      predecessorFingerprint: "predecessor",
    },
  };
}

function requireTask(state: RunState, taskId: string) {
  const task = state.tasks[taskId];
  if (task === undefined) {
    throw new Error(`测试状态缺少任务 ${taskId}`);
  }
  return task;
}
