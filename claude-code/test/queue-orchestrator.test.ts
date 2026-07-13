/*
 * 队列集成测试穿过真实应用服务与状态机，但以可观测 Fake 隔离外部系统。
 * 重点证明任务严格单并发、依赖顺序稳定，并且崩溃后的 executing 状态只恢复原会话。
 */
import { describe, expect, it } from "vitest";
import { PromptBuilder } from "../src/application/prompt-builder.js";
import { QueueOrchestrator } from "../src/application/queue-orchestrator.js";
import { TaskExecutionService } from "../src/application/task-execution-service.js";
import { createInitialRunState, transitionTask } from "../src/domain/run-state.js";
import {
  FakeClock,
  MemoryStateStore,
  PassingGateRunner,
  RecordingAgent,
  RecordingLogger,
  RecordingRunLock,
  RecordingWorkspace,
  completedBehavior,
  createLoadedManifest,
} from "./support/orchestrator-fixture.js";

describe("QueueOrchestrator", () => {
  it("按稳定依赖顺序执行，且任意时刻最多只有一个 Agent", async () => {
    const fixture = createFixture();
    const loaded = createLoadedManifest([
      { id: "TASK-B", dependsOn: ["TASK-A"] },
      { id: "TASK-A" },
      { id: "TASK-C", dependsOn: ["TASK-A"] },
    ]);

    const result = await fixture.orchestrator.start(loaded);

    expect(result.state.status).toBe("completed");
    expect(fixture.agent.maxActive).toBe(1);
    expect(fixture.gates.maxActive).toBe(1);
    expect(fixture.lock.maxActive).toBe(1);
    expect(fixture.workspace.commits).toEqual(["TASK-A", "TASK-B", "TASK-C"]);
    expect(fixture.agent.requests.map((request) => request.taskId)).toEqual([
      "TASK-A",
      "TASK-B",
      "TASK-C",
    ]);
    expect(result.artifacts).toHaveLength(2);
    expect(fixture.stateStore.snapshots.length).toBeGreaterThan(10);
  });

  it("恢复 executing checkpoint 时复用原 TASK 会话而不创建新会话", async () => {
    const fixture = createFixture();
    const loaded = createLoadedManifest([{ id: "TASK-A" }]);
    const initial = createInitialRunState({
      runId: "run-resume",
      manifestPath: loaded.manifestPath,
      manifestHash: loaded.manifestHash,
      projectRoot: loaded.projectRoot,
      workspace: {
        repositoryRoot: "/project",
        branch: "main",
        expectedHead: "base-sha",
      },
      taskIds: ["TASK-A"],
      now: "2026-07-13T00:00:00.000Z",
    });
    const executing = transitionTask(
      initial,
      "TASK-A",
      "executing",
      "2026-07-13T00:00:01.000Z",
      {
        attempts: [{
          number: 1,
          kind: "implementation",
          sessionId: "11111111-1111-4111-8111-111111111111",
          sessionInitialized: true,
          startedAt: "2026-07-13T00:00:01.000Z",
        }],
      },
    );
    await fixture.stateStore.save(executing);

    const result = await fixture.orchestrator.resume(loaded, executing.runId);

    expect(result.state.status).toBe("completed");
    expect(fixture.agent.requests).toHaveLength(1);
    expect(fixture.agent.requests[0]?.attemptKind).toBe("resume");
    expect(fixture.agent.requests[0]?.resumeSessionId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(fixture.agent.requests[0]?.sessionId).toBeUndefined();
  });

  it("恢复尚未初始化的 executing checkpoint 时创建全新会话", async () => {
    const fixture = createFixture();
    const loaded = createLoadedManifest([{ id: "TASK-A" }]);
    const initial = createInitialRunState({
      runId: "run-prepared-only",
      manifestPath: loaded.manifestPath,
      manifestHash: loaded.manifestHash,
      projectRoot: loaded.projectRoot,
      workspace: {
        repositoryRoot: "/project",
        branch: "main",
        expectedHead: "base-sha",
      },
      taskIds: ["TASK-A"],
      now: "2026-07-13T00:00:00.000Z",
    });
    const preparedOnly = transitionTask(
      initial,
      "TASK-A",
      "executing",
      "2026-07-13T00:00:01.000Z",
      {
        attempts: [{
          number: 1,
          kind: "implementation",
          sessionId: "22222222-2222-4222-8222-222222222222",
          sessionInitialized: false,
          startedAt: "2026-07-13T00:00:01.000Z",
        }],
      },
    );
    await fixture.stateStore.save(preparedOnly);

    const result = await fixture.orchestrator.resume(loaded, preparedOnly.runId);

    expect(result.state.status).toBe("completed");
    expect(fixture.agent.requests[0]?.resumeSessionId).toBeUndefined();
    expect(fixture.agent.requests[0]?.sessionId).not.toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("门禁改变候选内容时阻断任务且不提交", async () => {
    const workspace = new MutatingCandidateWorkspace();
    const fixture = createFixture(workspace);
    const loaded = createLoadedManifest([{ id: "TASK-A" }]);

    const result = await fixture.orchestrator.start(loaded);

    expect(result.state.status).toBe("blocked");
    expect(result.state.failureReason).toContain("门禁修改了候选文件");
    expect(workspace.commits).toEqual([]);
  });

  it("用全新只读会话审核门禁候选后再提交", async () => {
    const agent = new RecordingAgent((request) =>
      request.attemptKind === "review"
        ? {
            ok: true,
            sessionId: request.sessionId ?? "missing-review-session",
            data: {
              status: "approved",
              summary: "review approved",
              findings: [],
              blockingQuestions: [],
            },
            costUsd: 0.01,
            turns: 1,
          }
        : completedBehavior(request));
    const fixture = createFixture(new RecordingWorkspace(), agent);
    const base = createLoadedManifest([{ id: "TASK-A" }]);
    const loaded = {
      ...base,
      manifest: {
        ...base.manifest,
        review: {
          ...base.manifest.review,
          enabled: true,
        },
      },
    };

    const result = await fixture.orchestrator.start(loaded);

    expect(result.state.status).toBe("completed");
    expect(agent.requests.map((request) => request.attemptKind)).toEqual([
      "implementation",
      "review",
    ]);
    expect(agent.requests[1]?.access).toBe("read");
    expect(agent.requests[1]?.sessionId).not.toBe(agent.requests[0]?.sessionId);
  });
});

class MutatingCandidateWorkspace extends RecordingWorkspace {
  private captures = 0;

  public override async captureCandidate() {
    this.captures += 1;
    return {
      fingerprint: `candidate-${this.captures}`,
      diff: "diff",
    };
  }
}

function createFixture(
  workspace = new RecordingWorkspace(),
  agent = new RecordingAgent(),
) {
  const clock = new FakeClock();
  const gates = new PassingGateRunner();
  const stateStore = new MemoryStateStore();
  const lock = new RecordingRunLock();
  const logger = new RecordingLogger();
  const taskExecution = new TaskExecutionService(
    agent,
    gates,
    workspace,
    new PromptBuilder(),
    clock,
  );
  const orchestrator = new QueueOrchestrator(
    taskExecution,
    stateStore,
    lock,
    workspace,
    logger,
    clock,
  );
  return {
    orchestrator,
    agent,
    gates,
    workspace,
    stateStore,
    lock,
  };
}
