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
  createCandidate,
  createLoadedManifest,
} from "./support/orchestrator-fixture.js";
import type {
  CandidateSnapshot,
  VerificationWorkspace,
} from "../src/ports/workspace.js";

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
    expect(fixture.gates.workingDirectories).toEqual([
      "/verification",
      "/verification",
      "/verification",
    ]);
    expect(fixture.lock.maxActive).toBe(1);
    expect(fixture.workspace.commits).toEqual(["TASK-A", "TASK-B", "TASK-C"]);
    expect(fixture.agent.requests.map((request) => request.taskId)).toEqual([
      "TASK-A",
      "TASK-B",
      "TASK-C",
    ]);
    expect(fixture.agent.requests[0]?.prompt).toContain(
      "可以自主调用子 Agent、终端、技能和 MCP",
    );
    expect(result.artifacts).toHaveLength(2);
    expect(fixture.stateStore.snapshots.length).toBeGreaterThan(10);
    /*
     * 启动事件展示的是 Manifest 经 DAG 校验后的真实队列，而不是目录中碰巧存在的 TASK 文件。
     * 用户因此能在 Agent 启动前确认本次运行是否真的包含全部后续任务。
     */
    expect(fixture.logger.events[0]).toMatchObject({
      type: "run_started",
      details: { taskOrder: ["TASK-A", "TASK-B", "TASK-C"] },
    });
    expect(fixture.logger.events[0]?.message).toContain(
      "TASK-A → TASK-B → TASK-C",
    );
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

  it("默认持续修复超过旧三次上限直到任务完成", async () => {
    let implementationRuns = 0;
    const agent = new RecordingAgent((request) => {
      implementationRuns += 1;
      if (implementationRuns <= 5) {
        return {
          ok: true,
          sessionId: request.sessionId ?? "missing-session",
          data: {
            status: "failed",
            summary: `第 ${implementationRuns} 轮仍需修复`,
            blockingQuestions: [],
            notes: [],
          },
          costUsd: 0.01,
          turns: 1,
        };
      }
      return completedBehavior(request);
    });
    const fixture = createFixture(new RecordingWorkspace(), agent);
    const loaded = createLoadedManifest([{ id: "TASK-A" }]);

    const result = await fixture.orchestrator.start(loaded);

    expect(result.state.status).toBe("completed");
    expect(result.state.tasks["TASK-A"]?.attempts).toHaveLength(6);
    expect(agent.requests.map((request) => request.attemptKind)).toEqual([
      "implementation",
      "repair",
      "repair",
      "repair",
      "repair",
      "repair",
    ]);
    expect(agent.requests.every((request) =>
      request.maxTurns === undefined && request.timeoutMs === undefined)).toBe(true);
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

  it("门禁副作用在隔离工作区提升后自动修复并完整重验", async () => {
    const workspace = new MutatingCandidateWorkspace();
    const fixture = createFixture(workspace);
    const loaded = createLoadedManifest([{ id: "TASK-A" }]);

    const result = await fixture.orchestrator.start(loaded);

    expect(result.state.status).toBe("completed");
    expect(workspace.commits).toEqual(["TASK-A"]);
    expect(workspace.verificationDisposals).toBe(2);
    expect(fixture.agent.requests.map((request) => request.attemptKind)).toEqual([
      "implementation",
      "repair",
    ]);
    expect(result.state.tasks["TASK-A"]?.gateRuns.map((run) => ({
      outcome: run.outcome,
      mutatedFiles: run.mutatedFiles,
    }))).toEqual([
      { outcome: "mutated", mutatedFiles: ["src/candidate.ts"] },
      { outcome: "passed", mutatedFiles: [] },
    ]);
    const mutationEvent = fixture.logger.events.find(
      (event) => event.details?.["outcome"] === "mutated",
    );
    expect(mutationEvent?.type).toBe("task_progress");
    expect(mutationEvent?.details).toMatchObject({
      outcome: "mutated",
      mutatedFiles: ["src/candidate.ts"],
    });
  });

  it("任务阻塞后隔离候选、阻止依赖子图并继续独立任务", async () => {
    const agent = new RecordingAgent((request) =>
      request.taskId === "TASK-A"
        ? {
            ok: true,
            sessionId: request.sessionId ?? "missing-session",
            data: {
              status: "blocked",
              summary: "缺少产品决策",
              blockingQuestions: ["请选择唯一交互规则"],
              notes: [],
            },
            costUsd: 0.01,
            turns: 1,
          }
        : completedBehavior(request));
    const fixture = createFixture(new RecordingWorkspace(), agent);
    const loaded = createLoadedManifest([
      { id: "TASK-A" },
      { id: "TASK-C", dependsOn: ["TASK-A"] },
      { id: "TASK-B" },
    ]);

    const result = await fixture.orchestrator.start(loaded);

    expect(result.state.status).toBe("blocked");
    expect(result.state.tasks["TASK-A"]?.status).toBe("blocked");
    expect(result.state.tasks["TASK-A"]?.candidateArchive?.reference).toBe(
      "refs/quarantine/1",
    );
    expect(result.state.tasks["TASK-C"]?.status).toBe("dependency_blocked");
    expect(result.state.tasks["TASK-B"]?.status).toBe("completed");
    expect(fixture.workspace.commits).toEqual(["TASK-B"]);
    expect(agent.requests.map((request) => request.taskId)).toEqual([
      "TASK-A",
      "TASK-B",
    ]);
    expect(result.artifacts).toHaveLength(2);
  });

  it("隔离门禁越界变化只记录诊断且绝不提升到主候选", async () => {
    const workspace = new BoundaryViolatingWorkspace();
    const fixture = createFixture(workspace);
    const loaded = createLoadedManifest([{ id: "TASK-A" }]);

    const result = await fixture.orchestrator.start(loaded);

    expect(result.state.status).toBe("blocked");
    expect(result.state.tasks["TASK-A"]?.gateRuns).toMatchObject([{
      outcome: "boundary_violation",
      mutatedFiles: [".env"],
    }]);
    expect(workspace.promoted).toBe(false);
    expect(workspace.commits).toEqual([]);
    expect(workspace.verificationDisposals).toBe(1);
  });

  it("隔离 worktree 延迟清理不会覆盖门禁结果或中断队列", async () => {
    const workspace = new DeferredReleaseWorkspace();
    const fixture = createFixture(workspace);
    const loaded = createLoadedManifest([
      { id: "TASK-A" },
      { id: "TASK-B", dependsOn: ["TASK-A"] },
    ]);

    const result = await fixture.orchestrator.start(loaded);

    expect(result.state.status).toBe("completed");
    expect(workspace.commits).toEqual(["TASK-A", "TASK-B"]);
    const releaseEvents = fixture.logger.events.filter((event) =>
      event.message.includes("清理已延后"));
    expect(releaseEvents).toHaveLength(2);
    expect(releaseEvents[0]?.details).toMatchObject({
      verificationWorkspaceRelease: {
        status: "deferred",
        diagnostics: ["Windows 文件仍被占用"],
      },
    });
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
  private sourceCandidate = createCandidate("candidate-before");
  private verificationRuns = 0;

  public override async captureCandidate(): Promise<CandidateSnapshot> {
    return this.sourceCandidate;
  }

  /*
   * 第一次验证模拟 pnpm 补全锁文件，提升后第二次验证保持稳定。
   * Fake 不直接改主候选，只有 promoteCandidate 被应用层调用时才更新源快照。
   */
  public override async openVerificationWorkspace(input: {
    expectedCandidate: CandidateSnapshot;
  }): Promise<VerificationWorkspace> {
    this.verificationRuns += 1;
    const isolatedCandidate = this.verificationRuns === 1
      ? createCandidate("candidate-generated")
      : input.expectedCandidate;
    return {
      projectRoot: "/verification",
      auditChanges: (task) => this.auditChanges(task),
      captureCandidate: () => Promise.resolve(isolatedCandidate),
      promoteCandidate: () => {
        this.sourceCandidate = isolatedCandidate;
        return Promise.resolve();
      },
      dispose: () => {
        this.verificationDisposals += 1;
        return Promise.resolve({
          status: "released" as const,
          diagnostics: [],
        });
      },
    };
  }
}

class BoundaryViolatingWorkspace extends RecordingWorkspace {
  public promoted = false;

  /*
   * 验证副本新增受 deny 保护的 .env，应用层必须先记录 GateRun 再阻塞任务。
   * promoteCandidate 若被错误调用会改变 promoted，从而让测试直接暴露安全回归。
   */
  public override async openVerificationWorkspace(input: {
    expectedCandidate: CandidateSnapshot;
  }): Promise<VerificationWorkspace> {
    const isolatedCandidate: CandidateSnapshot = {
      fingerprint: "boundary-candidate",
      diff: "diff",
      files: [
        ...input.expectedCandidate.files,
        {
          path: ".env",
          kind: "file",
          mode: 0o100644,
          contentHash: "secret",
        },
      ],
    };
    return {
      projectRoot: "/verification",
      auditChanges: () => Promise.resolve({
        changedFiles: ["src/candidate.ts", ".env"],
        violations: [".env"],
      }),
      captureCandidate: () => Promise.resolve(isolatedCandidate),
      promoteCandidate: () => {
        this.promoted = true;
        return Promise.resolve();
      },
      dispose: () => {
        this.verificationDisposals += 1;
        return Promise.resolve({
          status: "released" as const,
          diagnostics: [],
        });
      },
    };
  }
}

class DeferredReleaseWorkspace extends RecordingWorkspace {
  /*
   * Fake 只模拟“业务验证已完成但临时目录仍被系统占用”的释放结果。
   * 候选、门禁和提交保持稳定，用于证明清理诊断不会改变队列状态流。
   */
  public override async openVerificationWorkspace(input: {
    expectedCandidate: CandidateSnapshot;
  }): Promise<VerificationWorkspace> {
    return {
      projectRoot: "/verification",
      auditChanges: (task) => this.auditChanges(task),
      captureCandidate: () => Promise.resolve(input.expectedCandidate),
      promoteCandidate: () => Promise.resolve(),
      dispose: () => Promise.resolve({
        status: "deferred",
        diagnostics: ["Windows 文件仍被占用"],
      }),
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
    logger,
  };
}
