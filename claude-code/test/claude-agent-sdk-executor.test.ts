/*
 * Claude Agent SDK 执行器测试只使用注入的 Query Factory 和内存消息流，不启动真实 Claude 进程。
 * 重点验证中止优先级、会话可信边界与终态协议，防止基础设施异常污染应用状态机。
 */
import type {
  Query,
  SDKMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ClaudeAgentSdkExecutor,
  type AgentQueryFactory,
} from "../src/infrastructure/claude/claude-agent-sdk-executor.js";
import type { AgentRunRequest } from "../src/ports/agent-executor.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const resultSchema = z.object({ status: z.literal("completed") });
type TestResult = z.infer<typeof resultSchema>;

describe("ClaudeAgentSdkExecutor", () => {
  it("外部信号已预先中止时不创建 Query", async () => {
    const externalController = new AbortController();
    externalController.abort();
    let factoryCalls = 0;
    const queryFactory: AgentQueryFactory = () => {
      factoryCalls += 1;
      return createFakeQuery(messageStream([]));
    };
    const executor = new ClaudeAgentSdkExecutor(queryFactory);

    const outcome = await executor.run(createRequest({
      signal: externalController.signal,
    }));

    expect(factoryCalls).toBe(0);
    expect(outcome).toMatchObject({
      ok: false,
      kind: "aborted",
      retryable: false,
    });
    expect(outcome.sessionId).toBeUndefined();
  });

  it("收到 system/init 时通知会话初始化回调", async () => {
    const initializedSessions: string[] = [];
    const queryFactory: AgentQueryFactory = () => createFakeQuery(messageStream([
      createInitMessage(SESSION_ID),
      createSuccessResult(SESSION_ID),
    ]));
    const executor = new ClaudeAgentSdkExecutor(queryFactory);

    const outcome = await executor.run(createRequest({
      onSessionInitialized: async (sessionId) => {
        initializedSessions.push(sessionId);
      },
    }));

    expect(initializedSessions).toEqual([SESSION_ID]);
    expect(outcome).toMatchObject({
      ok: true,
      sessionId: SESSION_ID,
      data: { status: "completed" },
    });
  });

  it("本地中止后即使 SDK 返回错误 result 仍映射为 aborted", async () => {
    const externalController = new AbortController();
    const queryFactory: AgentQueryFactory = ({ options }) => {
      const sdkSignal = options?.abortController?.signal;
      if (sdkSignal === undefined) {
        throw new Error("测试要求执行器向 SDK 传递 AbortController");
      }
      return createFakeQuery(abortResultStream(sdkSignal, SESSION_ID));
    };
    const executor = new ClaudeAgentSdkExecutor(queryFactory);

    const outcomePromise = executor.run(createRequest({
      signal: externalController.signal,
    }));
    externalController.abort();
    const outcome = await outcomePromise;

    expect(outcome).toMatchObject({
      ok: false,
      kind: "aborted",
      sessionId: SESSION_ID,
      retryable: false,
      costUsd: 0.25,
      turns: 2,
    });
  });

  it("Query Factory 在 init 前失败时不伪造 session", async () => {
    const executor = new ClaudeAgentSdkExecutor(() => {
      throw new Error("factory failed before init");
    });

    const outcome = await executor.run(createRequest());

    expect(outcome).toMatchObject({
      ok: false,
      kind: "execution",
      message: "factory failed before init",
    });
    expect(outcome.sessionId).toBeUndefined();
  });

  it("消息迭代在 init 前失败时不伪造 session 并关闭 Query", async () => {
    let closed = false;
    const queryFactory: AgentQueryFactory = () => createFakeQuery(
      failingMessageStream("iterator failed before init"),
      () => {
        closed = true;
      },
    );
    const executor = new ClaudeAgentSdkExecutor(queryFactory);

    const outcome = await executor.run(createRequest());

    expect(outcome).toMatchObject({
      ok: false,
      kind: "execution",
      message: "iterator failed before init",
    });
    expect(outcome.sessionId).toBeUndefined();
    expect(closed).toBe(true);
  });

  it("消息流没有 result 时返回协议错误", async () => {
    const queryFactory: AgentQueryFactory = () => createFakeQuery(messageStream([
      createInitMessage(SESSION_ID),
    ]));
    const executor = new ClaudeAgentSdkExecutor(queryFactory);

    const outcome = await executor.run(createRequest());

    expect(outcome).toMatchObject({
      ok: false,
      kind: "protocol",
      sessionId: SESSION_ID,
      retryable: true,
    });
  });
});

function createRequest(
  overrides: Partial<AgentRunRequest<TestResult>> = {},
): AgentRunRequest<TestResult> {
  return {
    access: "write",
    attemptKind: "implementation",
    taskId: "TASK-001",
    title: "测试任务",
    prompt: "执行测试任务",
    cwd: process.cwd(),
    model: "sonnet",
    effort: "high",
    maxTurns: 10,
    timeoutMs: 10_000,
    sessionId: SESSION_ID,
    pathBoundary: {
      projectRoot: process.cwd(),
      write: {
        allow: ["src/**"],
        deny: [],
        protectedPaths: [],
      },
    },
    resultSchema,
    ...overrides,
  };
}

/*
 * Fake Query 保留真实异步生成器的消费语义，只补充执行器清理阶段依赖的 close 方法。
 * 其余 SDK 控制方法不参与当前端口协议，避免单测与无关控制面产生耦合。
 */
function createFakeQuery(
  stream: AsyncGenerator<SDKMessage, void, unknown>,
  close: () => void = doNothing,
): Query {
  return Object.assign(stream, { close }) as Query;
}

async function* messageStream(
  messages: readonly SDKMessage[],
): AsyncGenerator<SDKMessage, void, unknown> {
  for (const message of messages) {
    yield message;
  }
}

async function* failingMessageStream(
  message: string,
): AsyncGenerator<SDKMessage, void, unknown> {
  yield* messageStream([]);
  throw new Error(message);
}

async function* abortResultStream(
  signal: AbortSignal,
  sessionId: string,
): AsyncGenerator<SDKMessage, void, unknown> {
  await waitForAbort(signal);
  yield createExecutionErrorResult(sessionId);
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function createInitMessage(sessionId: string): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    session_id: sessionId,
  } as SDKMessage;
}

function createSuccessResult(sessionId: string): SDKResultMessage {
  return {
    type: "result",
    subtype: "success",
    session_id: sessionId,
    total_cost_usd: 0.1,
    num_turns: 1,
    structured_output: { status: "completed" },
  } as SDKResultMessage;
}

function createExecutionErrorResult(sessionId: string): SDKResultMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    session_id: sessionId,
    total_cost_usd: 0.25,
    num_turns: 2,
    errors: ["aborted by test"],
    terminal_reason: "aborted_streaming",
  } as SDKResultMessage;
}

function doNothing(): void {
  return;
}
