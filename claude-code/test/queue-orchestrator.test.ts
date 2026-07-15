/*
 * 队列集成测试穿过真实应用服务与状态机，但以可观测 Fake 隔离外部系统。
 * 重点证明任务严格单并发、依赖顺序稳定，并且崩溃后的 executing 状态只恢复原会话。
 */
import { describe, expect, it } from "vitest";
import { PromptBuilder } from "../src/application/prompt-builder.js";
import { QueueOrchestrator } from "../src/application/queue-orchestrator.js";
import { TaskExecutionService } from "../src/application/task-execution-service.js";
import { TaskProgressReconciler } from "../src/application/task-progress-reconciler.js";
import { createInitialRunState, transitionTask } from "../src/domain/run-state.js";
import { BeijingTimeFormatter } from "../src/infrastructure/time/beijing-time-formatter.js";
import {
  FakeClock,
  MemoryStateStore,
  RecordingAgent,
  RecordingLogger,
  RecordingRunLock,
  RecordingWorkspace,
  completedBehavior,
  createLoadedManifest,
} from "./support/orchestrator-fixture.js";
import type { CandidateSnapshot } from "../src/ports/workspace.js";

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
    /*
     * v3 提示词只表达任务目标与职责，不再把旧路径清单或命令清单注入 Worker 上下文。
     * 两个负断言守护能力面与文案同时删除，避免未来只移除 SDK Hook 却恢复提示词约束。
     */
    expect(fixture.agent.requests[0]?.prompt).not.toContain("# 路径边界");
    expect(fixture.agent.requests[0]?.prompt).not.toContain("# 外部验收门禁");
    expect(result.artifacts).toHaveLength(2);
    expect(fixture.stateStore.snapshots.length).toBeGreaterThan(10);
    expect(result.state.runId).toMatch(
      /^2026-07-13T08-00-00-000\+08-00-[a-f0-9]{8}$/u,
    );
    expect(result.state.createdAt).toBe("2026-07-13T00:00:01.000Z");
    const summary = [...fixture.stateStore.artifacts.entries()]
      .find(([path]) => path.endsWith("/summary.md"))?.[1];
    expect(summary).toContain("创建时间：2026-07-13T08:00:01.000+08:00");
    expect(summary).not.toContain("创建时间：2026-07-13T00:00:01.000Z");
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

  it("新 run 核验并复用全部有效任务完成证据", async () => {
    const fixture = createFixture();
    const loaded = createLoadedManifest([
      { id: "TASK-A" },
      { id: "TASK-B", dependsOn: ["TASK-A"] },
    ]);

    const first = await fixture.orchestrator.start(loaded);
    const second = await fixture.orchestrator.start(loaded);

    expect(first.state.status).toBe("completed");
    expect(second.state.status).toBe("completed");
    expect(fixture.workspace.commits).toEqual(["TASK-A", "TASK-B"]);
    expect(fixture.agent.requests.map((request) => request.taskId)).toEqual([
      "TASK-A",
      "TASK-B",
    ]);
    expect(second.state.tasks["TASK-A"]?.completion?.origin).toBe("reused");
    expect(second.state.tasks["TASK-B"]?.completion?.origin).toBe("reused");
    const secondStart = fixture.logger.events.filter(
      (event) => event.type === "run_started",
    ).at(-1);
    expect(secondStart?.details).toMatchObject({
      fresh: false,
      reusedTaskIds: ["TASK-A", "TASK-B"],
      pendingTaskIds: [],
    });
  });

  it("run fresh 明确忽略有效完成证据并全量重跑", async () => {
    const fixture = createFixture();
    const loaded = createLoadedManifest([
      { id: "TASK-A" },
      { id: "TASK-B", dependsOn: ["TASK-A"] },
    ]);

    await fixture.orchestrator.start(loaded);
    const fresh = await fixture.orchestrator.start(loaded, { fresh: true });

    /*
     * fresh 只改变新 Run 的初始计划，不删除或伪造历史完成证据。
     * 第二轮仍产生新的完成提交，使后续默认 run 可以绑定这组最新依赖版本。
     */
    expect(fixture.workspace.commits).toEqual([
      "TASK-A",
      "TASK-B",
      "TASK-A",
      "TASK-B",
    ]);
    expect(fixture.agent.requests).toHaveLength(4);
    expect(fresh.state.tasks["TASK-A"]?.completion?.origin).toBe("executed");
    expect(fresh.state.tasks["TASK-B"]?.completion?.origin).toBe("executed");
  });

  it("现有代码无变化时仍冻结候选并形成完成证据", async () => {
    const workspace = new NoChangeWorkspace();
    const fixture = createFixture(workspace);
    const loaded = createLoadedManifest([{ id: "TASK-A" }]);

    const result = await fixture.orchestrator.start(loaded, { fresh: true });

    expect(result.state.status).toBe("completed");
    expect(fixture.agent.requests).toHaveLength(1);
    expect(workspace.commits).toEqual(["TASK-A"]);
    expect(result.state.tasks["TASK-A"]?.completion?.origin).toBe("executed");
  });

  it("任务契约变化只重跑该任务及其依赖下游", async () => {
    const fixture = createFixture();
    const initial = createLoadedManifest([
      { id: "TASK-A", contractRevision: "v1" },
      { id: "TASK-B", dependsOn: ["TASK-A"] },
      { id: "TASK-C" },
    ]);
    await fixture.orchestrator.start(initial);
    const changed = createLoadedManifest([
      { id: "TASK-A", contractRevision: "v2" },
      { id: "TASK-B", dependsOn: ["TASK-A"] },
      { id: "TASK-C" },
    ]);

    const result = await fixture.orchestrator.start(changed);

    expect(fixture.workspace.commits).toEqual([
      "TASK-A",
      "TASK-B",
      "TASK-C",
      "TASK-A",
      "TASK-B",
    ]);
    expect(result.state.tasks["TASK-A"]?.completion?.origin).toBe("executed");
    expect(result.state.tasks["TASK-B"]?.completion?.origin).toBe("executed");
    expect(result.state.tasks["TASK-C"]?.completion?.origin).toBe("reused");
    const startEvent = fixture.logger.events.filter(
      (event) => event.type === "run_started",
    ).at(-1);
    expect(startEvent?.details?.["reuseDecisions"]).toMatchObject([
      { taskId: "TASK-A", reason: "contract_changed" },
      { taskId: "TASK-B", reason: "dependency_changed" },
      { taskId: "TASK-C", reason: "reused" },
    ]);
  });

  it("契约恢复旧值时不越过较新的异契约完成提交", async () => {
    const fixture = createFixture();
    const versionOne = createLoadedManifest([
      { id: "TASK-A", contractRevision: "v1" },
    ]);
    const versionTwo = createLoadedManifest([
      { id: "TASK-A", contractRevision: "v2" },
    ]);

    await fixture.orchestrator.start(versionOne);
    await fixture.orchestrator.start(versionTwo);
    const restored = await fixture.orchestrator.start(versionOne);

    /*
     * 当前代码已经历 v2 任务，不能为了命中哈希而回退复用更老的 v1 提交。
     * 协调器只评价每个 TASK 在当前祖先链中的最新完成证据，保证状态演进单调可推导。
     */
    expect(fixture.workspace.commits).toEqual(["TASK-A", "TASK-A", "TASK-A"]);
    expect(restored.state.tasks["TASK-A"]?.completion?.origin).toBe("executed");
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
      tasks: [{ taskId: "TASK-A" }],
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
      tasks: [{ taskId: "TASK-A" }],
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

  it("用全新只读会话审核实现候选后再提交", async () => {
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
    expect(agent.requests[1]?.prompt).toContain("# 实际变更文件");
    expect(agent.requests[1]?.prompt).not.toContain("# 外部门禁结果");
  });
});

class NoChangeWorkspace extends RecordingWorkspace {
  /*
   * Fake 表示代码在 Run 开始前已经满足任务契约，Agent 核验后不需要产生文件差异。
   * 候选冻结和提交仍必须完整执行，避免把“无 diff”误判成需要 repair 的失败状态。
   */
  public override async captureCandidate(): Promise<CandidateSnapshot> {
    return {
      fingerprint: "empty-candidate",
      diff: "",
      files: [],
    };
  }
}

function createFixture(
  workspace = new RecordingWorkspace(),
  agent = new RecordingAgent(),
) {
  const clock = new FakeClock();
  const stateStore = new MemoryStateStore();
  const lock = new RecordingRunLock();
  const logger = new RecordingLogger();
  const timeFormatter = new BeijingTimeFormatter();
  const taskExecution = new TaskExecutionService(
    agent,
    workspace,
    new PromptBuilder(),
    clock,
  );
  const orchestrator = new QueueOrchestrator(
    taskExecution,
    new TaskProgressReconciler(workspace),
    stateStore,
    lock,
    workspace,
    logger,
    clock,
    timeFormatter,
  );
  return {
    orchestrator,
    agent,
    workspace,
    stateStore,
    lock,
    logger,
  };
}
