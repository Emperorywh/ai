/*
 * 队列集成测试穿过真实应用服务与状态机，但以可观测 Fake 隔离外部系统。
 * 重点证明任务严格线性、任意时刻单并发，并且崩溃后的 executing 状态只恢复原会话。
 */
import { describe, expect, it } from "vitest";
import { CommitStage } from "../src/application/commit-stage.js";
import { ImplementationStage } from "../src/application/implementation-stage.js";
import { PromptBuilder } from "../src/application/prompt-builder.js";
import { QueueOrchestrator } from "../src/application/queue-orchestrator.js";
import { RunArtifactWriter } from "../src/application/run-artifact-writer.js";
import { RunCheckpointWriter } from "../src/application/run-checkpoint-writer.js";
import { RunFinalizer } from "../src/application/run-finalizer.js";
import { RunResumeValidator } from "../src/application/run-resume-validator.js";
import { ReviewStage } from "../src/application/review-stage.js";
import { TaskExecutionService } from "../src/application/task-execution-service.js";
import { TaskProgressReconciler } from "../src/application/task-progress-reconciler.js";
import { TaskResourceBudget } from "../src/application/task-resource-budget.js";
import { TaskStageSupport } from "../src/application/task-stage-support.js";
import { TerminalCandidateService } from "../src/application/terminal-candidate-service.js";
import { WorkspaceBaselineResolver } from "../src/application/workspace-baseline-resolver.js";
import type { AgentRunOutcome } from "../src/domain/agent-result.js";
import { InfrastructureError } from "../src/domain/errors.js";
import {
  createInitialRunState,
  transitionTask,
  type RunState,
} from "../src/domain/run-state.js";
import { BeijingTimeFormatter } from "../src/infrastructure/time/beijing-time-formatter.js";
import type { AgentRunRequest } from "../src/ports/agent-executor.js";
import {
  FakeClock,
  FixedAgentModelResolver,
  FixedProjectContextProvider,
  MemoryStateStore,
  RecordingAgent,
  RecordingLogger,
  RecordingRunLock,
  RecordingWorkspace,
  completedBehavior,
  createLoadedProject,
} from "./support/orchestrator-fixture.js";
import type { CandidateSnapshot } from "../src/ports/workspace.js";

describe("QueueOrchestrator", () => {
  it("按数字线性顺序执行，且任意时刻最多只有一个 Agent", async () => {
    const fixture = createFixture();
    const loaded = createLoadedProject([
      { id: "TASK-003" },
      { id: "TASK-001" },
      { id: "TASK-002" },
    ]);

    const result = await fixture.orchestrator.start(loaded);

    expect(result.state.status).toBe("completed");
    expect(fixture.agent.maxActive).toBe(1);
    expect(fixture.lock.maxActive).toBe(1);
    expect(fixture.workspace.commits).toEqual(["TASK-001", "TASK-002", "TASK-003"]);
    expect(fixture.agent.requests.map((request) => request.taskId)).toEqual([
      "TASK-001",
      "TASK-001",
      "TASK-002",
      "TASK-002",
      "TASK-003",
      "TASK-003",
    ]);
    expect(fixture.agent.requests[0]?.prompt).toContain(
      "可以自主调用子 Agent、终端、技能和 MCP",
    );
    /*
     * 当前提示词只表达任务目标与职责，不把路径清单或命令清单注入 Worker 上下文。
     * 两个负断言守护能力面与文案同时删除，避免未来只移除 SDK Hook 却恢复提示词约束。
     */
    expect(fixture.agent.requests[0]?.prompt).not.toContain("# 路径边界");
    expect(fixture.agent.requests[0]?.prompt).not.toContain("# 外部验收门禁");
    expect(fixture.agent.requests[0]?.prompt).toContain("# 确定性项目清单");
    expect(fixture.agent.requests[0]?.prompt).toContain("# 验证协议");
    expect(fixture.agent.requests[1]?.prompt).toContain("# 实现者验证证据");
    expect(fixture.agent.requests[1]?.prompt).toContain("pnpm test");
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
    expect(summary).toContain("Agent 累计耗时：12ms");
    expect(summary).toContain(
      "模型握手：claude-sonnet-5 → claude-sonnet-5",
    );
    expect(result.state.tasks["TASK-001"]?.attempts[0]?.verifications)
      .toEqual([{
        scope: "full",
        command: "pnpm test",
        status: "passed",
        summary: "测试通过",
      }]);
    /*
     * 启动事件展示的是项目仓储经线性序列校验后的真实队列，而不是未校验的目录枚举结果。
     * 用户因此能在 Agent 启动前确认本次运行是否真的包含全部后续任务。
     */
    expect(fixture.logger.events[0]).toMatchObject({
      type: "run_started",
      details: { taskOrder: ["TASK-001", "TASK-002", "TASK-003"] },
    });
    expect(fixture.logger.events[0]?.message).toContain(
      "TASK-001 → TASK-002 → TASK-003",
    );
    expect(fixture.logger.events.at(-1)).toMatchObject({
      type: "run_completed",
      details: {
        metrics: {
          workerSessions: 3,
          reviewerSessions: 3,
          turns: 9,
          toolCalls: 6,
        },
      },
    });
  });

  it("新 run 核验并复用全部有效任务完成证据", async () => {
    const fixture = createFixture();
    const loaded = createLoadedProject([
      { id: "TASK-001" },
      { id: "TASK-002" },
    ]);

    const first = await fixture.orchestrator.start(loaded);
    const second = await fixture.orchestrator.start(loaded);

    expect(first.state.status).toBe("completed");
    expect(second.state.status).toBe("completed");
    expect(fixture.workspace.commits).toEqual(["TASK-001", "TASK-002"]);
    expect(fixture.agent.requests.map((request) => request.taskId)).toEqual([
      "TASK-001",
      "TASK-001",
      "TASK-002",
      "TASK-002",
    ]);
    expect(second.state.tasks["TASK-001"]?.completion?.origin).toBe("reused");
    expect(second.state.tasks["TASK-002"]?.completion?.origin).toBe("reused");
    const secondStart = fixture.logger.events.filter(
      (event) => event.type === "run_started",
    ).at(-1);
    expect(secondStart?.details).toMatchObject({
      fresh: false,
      reusedTaskIds: ["TASK-001", "TASK-002"],
      pendingTaskIds: [],
    });
  });

  it("run fresh 明确忽略有效完成证据并全量重跑", async () => {
    const fixture = createFixture();
    const loaded = createLoadedProject([
      { id: "TASK-001" },
      { id: "TASK-002" },
    ]);

    await fixture.orchestrator.start(loaded);
    const fresh = await fixture.orchestrator.start(loaded, { fresh: true });

    /*
     * fresh 只改变新 Run 的初始计划，不删除或伪造历史完成证据。
     * 第二轮仍产生新的完成提交，使后续默认 run 可以绑定这组最新前驱链。
     */
    expect(fixture.workspace.commits).toEqual([
      "TASK-001",
      "TASK-002",
      "TASK-001",
      "TASK-002",
    ]);
    expect(fixture.agent.requests).toHaveLength(8);
    expect(fresh.state.tasks["TASK-001"]?.completion?.origin).toBe("executed");
    expect(fresh.state.tasks["TASK-002"]?.completion?.origin).toBe("executed");
  });

  it("现有代码无变化时仍冻结候选并形成完成证据", async () => {
    const workspace = new NoChangeWorkspace();
    const fixture = createFixture(workspace);
    const loaded = createLoadedProject([{ id: "TASK-001" }]);

    const result = await fixture.orchestrator.start(loaded, { fresh: true });

    expect(result.state.status).toBe("completed");
    expect(fixture.agent.requests).toHaveLength(2);
    expect(workspace.commits).toEqual(["TASK-001"]);
    expect(result.state.tasks["TASK-001"]?.completion?.origin).toBe("executed");
  });

  it("任务契约变化后重跑该任务及全部线性后继", async () => {
    const fixture = createFixture();
    const initial = createLoadedProject([
      { id: "TASK-001", contractRevision: "v1" },
      { id: "TASK-002" },
      { id: "TASK-003" },
    ]);
    await fixture.orchestrator.start(initial);
    const changed = createLoadedProject([
      { id: "TASK-001", contractRevision: "v2" },
      { id: "TASK-002" },
      { id: "TASK-003" },
    ]);

    const result = await fixture.orchestrator.start(changed);

    expect(fixture.workspace.commits).toEqual([
      "TASK-001",
      "TASK-002",
      "TASK-003",
      "TASK-001",
      "TASK-002",
      "TASK-003",
    ]);
    expect(result.state.tasks["TASK-001"]?.completion?.origin).toBe("executed");
    expect(result.state.tasks["TASK-002"]?.completion?.origin).toBe("executed");
    expect(result.state.tasks["TASK-003"]?.completion?.origin).toBe("executed");
    const startEvent = fixture.logger.events.filter(
      (event) => event.type === "run_started",
    ).at(-1);
    expect(startEvent?.details?.["reuseDecisions"]).toMatchObject([
      { taskId: "TASK-001", reason: "contract_changed" },
      { taskId: "TASK-002", reason: "predecessor_changed" },
      { taskId: "TASK-003", reason: "predecessor_changed" },
    ]);
  });

  it("契约恢复旧值时不越过较新的异契约完成提交", async () => {
    const fixture = createFixture();
    const versionOne = createLoadedProject([
      { id: "TASK-001", contractRevision: "v1" },
    ]);
    const versionTwo = createLoadedProject([
      { id: "TASK-001", contractRevision: "v2" },
    ]);

    await fixture.orchestrator.start(versionOne);
    await fixture.orchestrator.start(versionTwo);
    const restored = await fixture.orchestrator.start(versionOne);

    /*
     * 当前代码已经历 v2 任务，不能为了命中哈希而回退复用更老的 v1 提交。
     * 协调器只评价每个 TASK 在当前祖先链中的最新完成证据，保证状态演进单调可推导。
     */
    expect(fixture.workspace.commits).toEqual(["TASK-001", "TASK-001", "TASK-001"]);
    expect(restored.state.tasks["TASK-001"]?.completion?.origin).toBe("executed");
  });

  it("恢复 executing checkpoint 时复用原 TASK 会话而不创建新会话", async () => {
    /*
     * 旧 attempt 已持久化 claude-sonnet-5，即使 CC Switch 此时切为 glm-5.2，恢复也必须保持原模型。
     * 恢复完成后的 Reviewer 是全新 attempt，才应读取并使用当前 glm-5.2 配置。
     */
    const modelResolver = new FixedAgentModelResolver("glm-5.2");
    const fixture = createFixture(
      new RecordingWorkspace(),
      new RecordingAgent(),
      modelResolver,
    );
    const loaded = createLoadedProject([{ id: "TASK-001" }]);
    const initial = createInitialRunState({
      runId: "run-resume",
      projectHash: loaded.projectHash,
      projectRoot: loaded.projectRoot,
      workspace: {
        repositoryRoot: "/project",
        branch: "main",
        expectedHead: "base-sha",
      },
      tasks: [{ taskId: "TASK-001" }],
      now: "2026-07-13T00:00:00.000Z",
    });
    const executing = transitionTask(
      initial,
      "TASK-001",
      "executing",
      "2026-07-13T00:00:01.000Z",
      {
        attempts: [{
          number: 1,
          kind: "implementation",
          sessionId: "11111111-1111-4111-8111-111111111111",
          sessionInitialized: true,
          requestedModel: "claude-sonnet-5",
          resolvedModel: "claude-sonnet-5",
          startedAt: "2026-07-13T00:00:01.000Z",
        }],
      },
    );
    await fixture.stateStore.save(executing);

    const result = await fixture.orchestrator.resume(loaded, executing.runId);

    expect(result.state.status).toBe("completed");
    expect(fixture.agent.requests).toHaveLength(2);
    expect(fixture.agent.requests[0]?.attemptKind).toBe("resume");
    expect(fixture.agent.requests[0]?.resumeSessionId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(fixture.agent.requests[0]?.sessionId).toBeUndefined();
    expect(fixture.agent.requests.map((request) => request.model)).toEqual([
      "claude-sonnet-5",
      "glm-5.2",
    ]);
    expect(modelResolver.resolvedDirectories).toEqual(["/project"]);
  });

  it("项目内容变化后拒绝恢复旧运行快照", async () => {
    const fixture = createFixture();
    const loaded = createLoadedProject([{ id: "TASK-001" }]);
    const initial = createInitialRunState({
      runId: "run-project-changed",
      projectHash: loaded.projectHash,
      projectRoot: loaded.projectRoot,
      workspace: {
        repositoryRoot: "/project",
        branch: "main",
        expectedHead: "base-sha",
      },
      tasks: [{ taskId: "TASK-001" }],
      now: "2026-07-13T00:00:00.000Z",
    });
    await fixture.stateStore.save(initial);

    /*
     * 恢复只绑定唯一规格和 TASK 内容哈希，不再依赖任何外部配置文件身份。
     * 任一项目事实变化都必须创建新 Run，避免新上下文与旧 checkpoint 混用。
     */
    await expect(fixture.orchestrator.resume(
      { ...loaded, projectHash: "changed-project-hash" },
      initial.runId,
    )).rejects.toThrow("不能混用旧运行状态");
  });

  it("会话启动基础设施故障不消耗 repair 预算且可原地恢复", async () => {
    const agent = new FailOnceLaunchAgent();
    const fixture = createFixture(new RecordingWorkspace(), agent);
    const loaded = createLoadedProject([{ id: "TASK-001" }]);

    const interrupted = await fixture.orchestrator.start(loaded);

    /*
     * 首次启动在 init 前中断，因此 Run 与 TASK 都必须保持可恢复的非终态；
     * attempt 仍是唯一 implementation，不能伪造 failed/repair 记录或提前生成验收产物。
     */
    expect(interrupted.state.status).toBe("running");
    expect(interrupted.state.tasks["TASK-001"]?.status).toBe("executing");
    expect(interrupted.state.tasks["TASK-001"]?.attempts).toHaveLength(1);
    expect(interrupted.state.tasks["TASK-001"]?.attempts[0]).toMatchObject({
      kind: "implementation",
      sessionInitialized: false,
    });
    expect(interrupted.artifacts).toEqual([]);
    expect(fixture.logger.events.at(-1)).toMatchObject({
      type: "run_infrastructure_interrupted",
      taskId: "TASK-001",
    });

    const resumed = await fixture.orchestrator.resume(
      loaded,
      interrupted.state.runId,
    );

    expect(resumed.state.status).toBe("completed");
    expect(resumed.state.tasks["TASK-001"]?.attempts).toHaveLength(1);
    expect(agent.requests.map((request) => request.attemptKind)).toEqual([
      "implementation",
      "implementation",
      "review",
    ]);
    expect(agent.requests[1]?.sessionId).not.toBe(
      agent.requests[0]?.sessionId,
    );
  });

  it("Reviewer 启动基础设施故障复用同一审核 attempt", async () => {
    const agent = new FailOnceReviewLaunchAgent();
    const fixture = createFixture(new RecordingWorkspace(), agent);
    const loaded = createLoadedProject([{ id: "TASK-001" }]);

    const interrupted = await fixture.orchestrator.start(loaded);

    /*
     * Worker 已完成而 Reviewer 尚未 init，故障边界必须停在 reviewing，并保留唯一未完成审核。
     * 该零资源 attempt 恢复后只更换 sessionId，不能提前触发三次 Reviewer 上限。
     */
    expect(interrupted.state.status).toBe("running");
    expect(interrupted.state.tasks["TASK-001"]?.status).toBe("reviewing");
    expect(interrupted.state.tasks["TASK-001"]?.reviewAttempts).toHaveLength(1);
    expect(interrupted.state.tasks["TASK-001"]?.reviewAttempts[0]).toMatchObject({
      sessionInitialized: false,
    });

    const resumed = await fixture.orchestrator.resume(
      loaded,
      interrupted.state.runId,
    );

    expect(resumed.state.status).toBe("completed");
    expect(resumed.state.tasks["TASK-001"]?.reviewAttempts).toHaveLength(1);
    expect(agent.requests.map((request) => request.attemptKind)).toEqual([
      "implementation",
      "review",
      "review",
    ]);
    expect(agent.requests[2]?.sessionId).not.toBe(
      agent.requests[1]?.sessionId,
    );
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
            verifications: [],
          },
          costUsd: 0.01,
          turns: 1,
        };
      }
      return completedBehavior(request);
    });
    const fixture = createFixture(new RecordingWorkspace(), agent);
    const loaded = createLoadedProject([{ id: "TASK-001" }]);

    const result = await fixture.orchestrator.start(loaded);

    expect(result.state.status).toBe("completed");
    expect(result.state.tasks["TASK-001"]?.attempts).toHaveLength(6);
    expect(agent.requests.map((request) => request.attemptKind)).toEqual([
      "implementation",
      "repair",
      "repair",
      "repair",
      "repair",
      "repair",
      "review",
    ]);
    expect(agent.requests.every((request) =>
      request.maxTurns !== undefined
      && request.maxBudgetUsd !== undefined
      && request.timeoutMs !== undefined)).toBe(true);
  });

  it("Worker 报告 completed 但存在失败验证时仍进入 repair", async () => {
    let workerRuns = 0;
    const agent = new RecordingAgent((request) => {
      if (request.attemptKind === "review") {
        return completedBehavior(request);
      }
      workerRuns += 1;
      if (workerRuns > 1) {
        return completedBehavior(request);
      }
      return {
        ok: true,
        sessionId: request.sessionId ?? "missing-session",
        data: {
          status: "completed",
          summary: "实现完成但测试失败",
          blockingQuestions: [],
          notes: [],
          verifications: [{
            scope: "full",
            command: "pnpm test",
            status: "failed",
            summary: "1 项失败",
          }],
        },
        costUsd: 0.01,
        turns: 1,
      };
    });
    const fixture = createFixture(new RecordingWorkspace(), agent);

    const result = await fixture.orchestrator.start(
      createLoadedProject([{ id: "TASK-001" }]),
    );

    expect(result.state.status).toBe("completed");
    expect(result.state.tasks["TASK-001"]?.attempts.map((attempt) => attempt.kind))
      .toEqual(["implementation", "repair"]);
  });

  it("Reviewer 将可修复缺陷误标为 blocked 时仍进入 repair", async () => {
    let reviewRuns = 0;
    const agent = new RecordingAgent((request) => {
      if (request.attemptKind !== "review") {
        return completedBehavior(request);
      }
      reviewRuns += 1;
      if (reviewRuns > 1) {
        return completedBehavior(request);
      }
      return {
        ok: true,
        sessionId: request.sessionId ?? "missing-review-session",
        data: {
          status: "blocked",
          summary: "存在可以由 Worker 修复的契约偏差",
          findings: [{
            severity: "medium",
            message: "新增资产未满足任务契约",
          }],
          blockingQuestions: ["是否接受当前资产"],
        },
        costUsd: 0.01,
        turns: 1,
      };
    });
    const fixture = createFixture(new RecordingWorkspace(), agent);

    /*
     * finding 表明问题可由候选修改解决，必须覆盖模型误给的 blocked 标签并继续 repair。
     * 第二次审核通过后 Run 正常提交，证明人工阻塞不会吞掉已有的可操作修复反馈。
     */
    const result = await fixture.orchestrator.start(
      createLoadedProject([{ id: "TASK-001" }]),
    );

    expect(result.state.status).toBe("completed");
    expect(result.state.tasks["TASK-001"]?.reviewAttempts.map(
      (attempt) => attempt.outcome,
    )).toEqual(["rejected", "approved"]);
    expect(agent.requests.map((request) => request.attemptKind)).toEqual([
      "implementation",
      "review",
      "repair",
      "review",
    ]);
  });

  it("Worker 首次报告 blocked 时必须经过独立审计且不能被 approved 后提交", async () => {
    let workerRuns = 0;
    const agent = new RecordingAgent((request) => {
      if (request.attemptKind === "review") {
        return completedBehavior(request);
      }
      workerRuns += 1;
      if (workerRuns > 1) {
        return completedBehavior(request);
      }
      return {
        ok: true,
        sessionId: request.sessionId ?? "missing-session",
        data: {
          status: "blocked",
          summary: "把人工界面验收误当成实现前置条件",
          blockingQuestions: ["请人工打开浏览器确认"],
          notes: [],
          verifications: [],
        },
        costUsd: 0.01,
        turns: 1,
      };
    });
    const fixture = createFixture(new RecordingWorkspace(), agent);

    /*
     * Fake Reviewer 第一次误返回 approved；应用层必须把它归一化为 rejected，清除旧阻塞报告并交回 Worker。
     * 第二次 Worker 完成后才能经过普通审核和提交，证明 blocked 与 approved 都不能绕过候选完成证据。
     */
    const result = await fixture.orchestrator.start(
      createLoadedProject([{ id: "TASK-001" }]),
    );

    expect(result.state.status).toBe("completed");
    expect(result.state.tasks["TASK-001"]?.attempts.map(
      (attempt) => attempt.outcome,
    )).toEqual(["blocked", "completed"]);
    expect(result.state.tasks["TASK-001"]?.reviewAttempts.map(
      (attempt) => attempt.outcome,
    )).toEqual(["rejected", "approved"]);
    expect(result.state.tasks["TASK-001"]?.workerBlocker).toBeUndefined();
    expect(agent.requests.map((request) => request.attemptKind)).toEqual([
      "implementation",
      "review",
      "repair",
      "review",
    ]);
    expect(agent.requests[1]?.prompt).toContain("# Worker 阻塞独立审计协议");
    expect(agent.requests[1]?.prompt).toContain("把人工界面验收误当成实现前置条件");
    expect(agent.requests[1]?.prompt).toContain("本轮不得返回 approved");
    expect(agent.requests[3]?.prompt).not.toContain("# Worker 阻塞报告");
  });

  it("resume 恢复 Reviewer 阻塞的隔离候选并继续审核", async () => {
    let reviewRuns = 0;
    const workspace = new RecordingWorkspace();
    const agent = new RecordingAgent((request) => {
      if (request.attemptKind !== "review") {
        return completedBehavior(request);
      }
      reviewRuns += 1;
      if (reviewRuns > 1) {
        return completedBehavior(request);
      }
      return {
        ok: true,
        sessionId: request.sessionId ?? "missing-review-session",
        data: {
          status: "blocked",
          summary: "需要重新判定候选是否满足契约",
          findings: [],
          blockingQuestions: ["是否接受当前可逆实现选择"],
        },
        costUsd: 0.01,
        turns: 1,
      };
    });
    const fixture = createFixture(workspace, agent);
    const loaded = createLoadedProject([{ id: "TASK-001" }]);

    /*
     * 第一次运行模拟历史版本留下的 Reviewer 误阻塞；候选必须先进入 quarantine 并形成终态。
     * resume 随后应从可信引用恢复并重新冻结候选、消费归档，再创建全新 Reviewer 会话直至提交。
     */
    const blocked = await fixture.orchestrator.start(loaded);
    const resumed = await fixture.orchestrator.resume(
      loaded,
      blocked.state.runId,
    );

    expect(blocked.state.status).toBe("blocked");
    expect(resumed.state.status).toBe("completed");
    expect(workspace.restoredCandidates).toEqual([{
      reference: "refs/quarantine/1",
      expectedFingerprint: "stable-candidate",
    }]);
    expect(workspace.consumedCandidateArchives).toEqual(["refs/quarantine/1"]);
    expect(resumed.state.tasks["TASK-001"]?.candidateArchive).toBeUndefined();
    expect(resumed.state.tasks["TASK-001"]?.reviewAttempts.map(
      (attempt) => attempt.outcome,
    )).toEqual(["blocked", "approved"]);
    expect(agent.requests.map((request) => request.attemptKind)).toEqual([
      "implementation",
      "review",
      "review",
    ]);
  });

  it("达到 TASK Worker 会话预算后停止 repair 并转为可解释阻塞", async () => {
    const agent = new RecordingAgent((request) => ({
      ok: true,
      sessionId: request.sessionId ?? "missing-session",
      data: {
        status: "failed",
        summary: "仍未完成",
        blockingQuestions: [],
        notes: [],
        verifications: [],
      },
      costUsd: 0.01,
      turns: 1,
    }));
    const fixture = createFixture(new RecordingWorkspace(), agent);

    const result = await fixture.orchestrator.start(
      createLoadedProject([{ id: "TASK-001" }]),
    );

    expect(result.state.status).toBe("blocked");
    expect(result.state.tasks["TASK-001"]?.attempts).toHaveLength(8);
    expect(result.state.tasks["TASK-001"]?.failureReason).toContain(
      "Worker 会话数已达到系统上限 8",
    );
    expect(agent.requests).toHaveLength(8);
    expect(fixture.workspace.quarantines).toBe(1);
  });

  it("达到 Reviewer 会话预算后不再创建第四个审核会话", async () => {
    const agent = new RecordingAgent((request) => {
      if (request.attemptKind !== "review") {
        return completedBehavior(request);
      }
      return {
        ok: true,
        sessionId: request.sessionId ?? "missing-review-session",
        data: {
          status: "rejected",
          summary: "仍有中等级别问题",
          findings: [{ severity: "medium", message: "需要继续修复" }],
          blockingQuestions: [],
        },
        costUsd: 0.01,
        turns: 1,
      };
    });
    const fixture = createFixture(new RecordingWorkspace(), agent);

    const result = await fixture.orchestrator.start(
      createLoadedProject([{ id: "TASK-001" }]),
    );

    expect(result.state.status).toBe("blocked");
    expect(result.state.tasks["TASK-001"]?.reviewAttempts).toHaveLength(3);
    expect(result.state.tasks["TASK-001"]?.failureReason).toContain(
      "Reviewer 会话数已达到系统上限 3",
    );
    expect(agent.requests.filter((request) => request.attemptKind === "review"))
      .toHaveLength(3);
  });

  it("Reviewer 认证失败时立即终止且不消耗全部重试预算", async () => {
    const agent = new RecordingAgent((request) => {
      if (request.attemptKind !== "review") {
        return completedBehavior(request);
      }
      return {
        ok: false,
        sessionId: request.sessionId ?? "missing-review-session",
        kind: "authentication",
        message: "Claude Code 认证失败：Not logged in",
        costUsd: 0,
        turns: 1,
        retryable: false,
      };
    });
    const fixture = createFixture(new RecordingWorkspace(), agent);

    /*
     * 认证配置需要用户修复，原样创建第二、第三个 Reviewer 不可能改变结果。
     * 状态机应保留一次失败事实并立即结束，避免把基础设施配置问题伪装成资源耗尽。
     */
    const result = await fixture.orchestrator.start(
      createLoadedProject([{ id: "TASK-001" }]),
    );

    expect(result.state.status).toBe("failed");
    expect(result.state.tasks["TASK-001"]?.reviewAttempts).toHaveLength(1);
    expect(result.state.tasks["TASK-001"]?.failureReason).toContain("认证失败");
    expect(agent.requests.filter((request) => request.attemptKind === "review"))
      .toHaveLength(1);
  });

  it("恢复尚未初始化的 executing checkpoint 时创建全新会话", async () => {
    const fixture = createFixture();
    const loaded = createLoadedProject([{ id: "TASK-001" }]);
    const initial = createInitialRunState({
      runId: "run-prepared-only",
      projectHash: loaded.projectHash,
      projectRoot: loaded.projectRoot,
      workspace: {
        repositoryRoot: "/project",
        branch: "main",
        expectedHead: "base-sha",
      },
      tasks: [{ taskId: "TASK-001" }],
      now: "2026-07-13T00:00:00.000Z",
    });
    const preparedOnly = transitionTask(
      initial,
      "TASK-001",
      "executing",
      "2026-07-13T00:00:01.000Z",
      {
        attempts: [{
          number: 1,
          kind: "implementation",
          sessionId: "22222222-2222-4222-8222-222222222222",
          sessionInitialized: false,
          requestedModel: "claude-sonnet-5",
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

  it("在 Worker 终态与候选捕获之间崩溃时不重复运行实现会话", async () => {
    const workspace = new FailOnceCandidateWorkspace();
    const fixture = createFixture(workspace);
    const loaded = createLoadedProject([{ id: "TASK-001" }]);

    await expect(fixture.orchestrator.start(loaded)).rejects.toThrow(
      "candidate capture interrupted",
    );
    const interrupted = await fixture.orchestrator.getState();
    expect(interrupted?.tasks["TASK-001"]?.status).toBe("candidate_pending");
    if (interrupted === undefined) {
      throw new Error("测试期望保留 candidate_pending checkpoint");
    }

    const result = await fixture.orchestrator.resume(loaded, interrupted.runId);

    expect(result.state.status).toBe("completed");
    expect(fixture.agent.requests.map((request) => request.attemptKind)).toEqual([
      "implementation",
      "review",
    ]);
  });

  it("提交前自动协调仅影响兄弟项目的 HEAD 快进", async () => {
    const workspace = new AdvanceHeadDuringReviewWorkspace();
    const fixture = createFixture(workspace);
    const loaded = createLoadedProject([{ id: "TASK-001" }]);

    const result = await fixture.orchestrator.start(loaded);

    /*
     * Reviewer 材料冻结后模拟兄弟项目提交，CommitStage 必须先 checkpoint 新基线再提交。
     * 最终提交父级因此是 sibling-head，不能先报基础设施故障再依赖人工 resume。
     */
    expect(result.state.status).toBe("completed");
    expect(workspace.commitExpectedHeads).toEqual(["sibling-head"]);
    expect(fixture.stateStore.snapshots.some(
      (snapshot) => snapshot.workspace.expectedHead === "sibling-head",
    )).toBe(true);
    expect(fixture.logger.events).toContainEqual(
      expect.objectContaining({
        type: "task_progress",
        details: {
          previousExpectedHead: "base-sha",
          reconciledExpectedHead: "sibling-head",
        },
      }),
    );
  });

  it("恢复 committing 快照时协调既有的项目外 HEAD 快进", async () => {
    const workspace = new RecordingWorkspace();
    workspace.advanceHead("sibling-head");
    const fixture = createFixture(workspace);
    const loaded = createLoadedProject([{ id: "TASK-001" }]);
    const committing = createCommittingState(loaded);
    await fixture.stateStore.save(committing);

    const result = await fixture.orchestrator.resume(loaded, committing.runId);

    /*
     * 该状态形状复现故障现场：审核已通过、候选仍在、expectedHead 落后一个兄弟项目提交。
     * resume 必须先持久化 sibling-head，再直接完成提交且不重新运行 Worker 或 Reviewer。
     */
    expect(result.state.status).toBe("completed");
    expect(workspace.commitExpectedHeads).toEqual(["sibling-head"]);
    expect(fixture.agent.requests).toEqual([]);
    expect(fixture.logger.events[0]).toMatchObject({
      type: "run_resumed",
      details: {
        previousExpectedHead: "base-sha",
        reconciledExpectedHead: "sibling-head",
      },
    });
  });

  it("恢复时继续拒绝改变当前项目树的 HEAD 前移", async () => {
    const workspace = new RecordingWorkspace();
    workspace.advanceHead("project-changed-head", ["src/app.ts"]);
    const fixture = createFixture(workspace);
    const loaded = createLoadedProject([{ id: "TASK-001" }]);
    const committing = createCommittingState(loaded);
    await fixture.stateStore.save(committing);

    await expect(
      fixture.orchestrator.resume(loaded, committing.runId),
    ).rejects.toThrow("当前项目已变化：src/app.ts");
    expect(workspace.commits).toEqual([]);
  });

  it("Reviewer 确认 Worker 的真实外部阻塞后才终止线性队列", async () => {
    const agent = new RecordingAgent((request) => {
      if (request.taskId !== "TASK-001") {
        return completedBehavior(request);
      }
      if (request.attemptKind === "review") {
        return {
          ok: true,
          sessionId: request.sessionId ?? "missing-review-session",
          data: {
            status: "blocked",
            summary: "不可逆产品决策确实缺失",
            findings: [],
            blockingQuestions: ["请选择唯一交互规则"],
          },
          costUsd: 0.01,
          turns: 1,
        };
      }
      return {
        ok: true,
        sessionId: request.sessionId ?? "missing-session",
        data: {
          status: "blocked",
          summary: "缺少产品决策",
          blockingQuestions: ["请选择唯一交互规则"],
          notes: [],
          verifications: [],
        },
        costUsd: 0.01,
        turns: 1,
      };
    });
    const fixture = createFixture(new RecordingWorkspace(), agent);
    const loaded = createLoadedProject([
      { id: "TASK-001" },
      { id: "TASK-003" },
      { id: "TASK-002" },
    ]);

    const result = await fixture.orchestrator.start(loaded);

    expect(result.state.status).toBe("blocked");
    expect(result.state.tasks["TASK-001"]?.status).toBe("blocked");
    expect(result.state.tasks["TASK-001"]?.reviewAttempts.at(-1)?.outcome)
      .toBe("blocked");
    expect(result.state.tasks["TASK-001"]?.workerBlocker).toEqual({
      summary: "缺少产品决策",
      blockingQuestions: ["请选择唯一交互规则"],
    });
    expect(result.state.tasks["TASK-001"]?.candidateArchive?.reference).toBe(
      "refs/quarantine/1",
    );
    expect(result.state.tasks["TASK-002"]?.status).toBe("pending");
    expect(result.state.tasks["TASK-003"]?.status).toBe("pending");
    expect(fixture.workspace.commits).toEqual([]);
    expect(agent.requests.map((request) => request.attemptKind)).toEqual([
      "implementation",
      "review",
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
    /*
     * 这里用 CC Switch 风格的第三方模型名覆盖默认 Fake，验证模型不再来自静态编排策略。
     * Worker 与 Reviewer 分别创建 attempt，所以两次都应解析并请求同一个当前模型。
     */
    const modelResolver = new FixedAgentModelResolver("glm-5.2");
    const fixture = createFixture(
      new RecordingWorkspace(),
      agent,
      modelResolver,
    );
    const loaded = createLoadedProject([{ id: "TASK-001" }]);

    const result = await fixture.orchestrator.start(loaded);

    expect(result.state.status).toBe("completed");
    expect(agent.requests.map((request) => request.attemptKind)).toEqual([
      "implementation",
      "review",
    ]);
    expect(agent.requests[1]?.access).toBe("read");
    expect(agent.requests.map((request) => [request.model, request.effort])).toEqual([
      ["glm-5.2", "high"],
      ["glm-5.2", "high"],
    ]);
    expect(modelResolver.resolvedDirectories).toEqual(["/project", "/project"]);
    expect(agent.requests[1]?.sessionId).not.toBe(agent.requests[0]?.sessionId);
    expect(agent.requests[1]?.prompt).toContain("# 实际变更文件");
    /*
     * Reviewer 必须收到冻结候选、原子提交和状态分流事实，不能再从工作区的 ?? 状态猜测提交范围。
     * 这些断言防止未来精简提示词时重新引入本次误阻塞根因。
     */
    expect(agent.requests[1]?.prompt).toContain(
      "是编排器已经冻结并校验指纹的完整候选",
    );
    expect(agent.requests[1]?.prompt).toContain(
      "不得改写成“是否接受偏离”的人工问题",
    );
    expect(agent.requests[1]?.prompt).toContain(
      "不得仅因希望维护者确认偏好而返回 blocked",
    );
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
      files: [],
    };
  }

  public override async captureReviewCandidate() {
    return {
      candidate: await this.captureCandidate(),
      diff: "",
    };
  }
}

class AdvanceHeadDuringReviewWorkspace extends RecordingWorkspace {
  private advanced = false;

  public override async captureReviewCandidate() {
    const review = await super.captureReviewCandidate();
    if (!this.advanced) {
      this.advanced = true;
      this.advanceHead("sibling-head");
    }
    return review;
  }
}

class FailOnceCandidateWorkspace extends RecordingWorkspace {
  private shouldFail = true;

  /*
   * Fake 只在首次候选身份捕获时模拟进程边界故障；恢复后返回稳定候选。
   * 这证明 candidate_pending 是独立 checkpoint，而不是依赖内存标志跳过 Worker。
   */
  public override async captureCandidate(): Promise<CandidateSnapshot> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error("candidate capture interrupted");
    }
    return super.captureCandidate();
  }
}

class FailOnceLaunchAgent extends RecordingAgent {
  private shouldFail = true;

  /*
   * 首次调用在 onSessionInitialized 之前模拟原生进程不可启动；第二次调用回到标准 Fake，
   * 用同一对象证明 resume 只重建未初始化 session，不增加 attempt 或切换为 repair。
   */
  public override async run<T>(
    request: AgentRunRequest<T>,
  ): Promise<AgentRunOutcome<T>> {
    if (this.shouldFail) {
      this.shouldFail = false;
      this.requests.push(request);
      throw new InfrastructureError("Claude Code 子进程启动失败");
    }
    return super.run<T>(request);
  }
}

class FailOnceReviewLaunchAgent extends RecordingAgent {
  private shouldFailReview = true;

  /*
   * Worker 保持默认成功，仅首次 Reviewer 在 init 前抛出基础设施故障。
   * 请求仍被记录，以便断言恢复前后是两个 session、同一个 review attempt。
   */
  public override async run<T>(
    request: AgentRunRequest<T>,
  ): Promise<AgentRunOutcome<T>> {
    if (request.attemptKind === "review" && this.shouldFailReview) {
      this.shouldFailReview = false;
      this.requests.push(request);
      throw new InfrastructureError("Claude Code Reviewer 子进程启动失败");
    }
    return super.run<T>(request);
  }
}

function createCommittingState(
  loaded: ReturnType<typeof createLoadedProject>,
): RunState {
  const initial = createInitialRunState({
    runId: "run-commit-head-advance",
    projectHash: loaded.projectHash,
    projectRoot: loaded.projectRoot,
    workspace: {
      repositoryRoot: "/project",
      branch: "main",
      expectedHead: "base-sha",
    },
    tasks: [{ taskId: "TASK-001" }],
    now: "2026-07-13T00:00:00.000Z",
  });
  const task = initial.tasks["TASK-001"];
  if (task === undefined) {
    throw new Error("测试状态缺少 TASK-001");
  }
  /*
   * 直接构造审核完成后的合法 checkpoint，聚焦恢复入口而不重复执行前置 Agent 阶段。
   * 字段满足 RunState v6 的尝试时间线、候选指纹与 Reviewer 通过证据不变量。
   */
  return {
    ...initial,
    updatedAt: "2026-07-13T00:00:04.000Z",
    tasks: {
      "TASK-001": {
        ...task,
        status: "committing",
        candidateFingerprint: "stable-candidate",
        attempts: [{
          number: 1,
          kind: "implementation",
          sessionId: "11111111-1111-4111-8111-111111111111",
          sessionInitialized: true,
          requestedModel: "claude-sonnet-5",
          resolvedModel: "claude-sonnet-5",
          startedAt: "2026-07-13T00:00:01.000Z",
          finishedAt: "2026-07-13T00:00:02.000Z",
          outcome: "completed",
          verifications: [{
            scope: "full",
            command: "pnpm test",
            status: "passed",
            summary: "测试通过",
          }],
        }],
        reviewAttempts: [{
          number: 1,
          sessionId: "22222222-2222-4222-8222-222222222222",
          sessionInitialized: true,
          requestedModel: "claude-sonnet-5",
          resolvedModel: "claude-sonnet-5",
          startedAt: "2026-07-13T00:00:02.000Z",
          finishedAt: "2026-07-13T00:00:03.000Z",
          outcome: "approved",
        }],
        updatedAt: "2026-07-13T00:00:04.000Z",
      },
    },
  };
}

function createFixture(
  workspace = new RecordingWorkspace(),
  agent = new RecordingAgent(),
  modelResolver = new FixedAgentModelResolver(),
) {
  const clock = new FakeClock();
  const stateStore = new MemoryStateStore();
  const lock = new RecordingRunLock();
  const logger = new RecordingLogger();
  const timeFormatter = new BeijingTimeFormatter();
  const promptBuilder = new PromptBuilder();
  const resourceBudget = new TaskResourceBudget();
  const stageSupport = new TaskStageSupport(clock);
  const baselineResolver = new WorkspaceBaselineResolver(workspace);
  const taskExecution = new TaskExecutionService(
    new ImplementationStage(
      agent,
      workspace,
      promptBuilder,
      new FixedProjectContextProvider(),
      modelResolver,
      clock,
      resourceBudget,
      stageSupport,
    ),
    new ReviewStage(
      agent,
      workspace,
      promptBuilder,
      new FixedProjectContextProvider(),
      modelResolver,
      clock,
      resourceBudget,
      stageSupport,
    ),
    new CommitStage(workspace, stageSupport, baselineResolver),
  );
  const checkpoints = new RunCheckpointWriter(stateStore, logger, clock);
  const orchestrator = new QueueOrchestrator({
    taskExecution,
    taskProgress: new TaskProgressReconciler(workspace),
    stateStore,
    runLock: lock,
    workspace,
    checkpoints,
    resumeValidator: new RunResumeValidator(workspace, baselineResolver),
    finalizer: new RunFinalizer(),
    artifacts: new RunArtifactWriter(stateStore, timeFormatter),
    terminalCandidates: new TerminalCandidateService(
      workspace,
      checkpoints,
      clock,
    ),
    clock,
    timeFormatter,
  });
  return {
    orchestrator,
    agent,
    modelResolver,
    workspace,
    stateStore,
    lock,
    logger,
  };
}
