/*
 * Claude Agent SDK 执行器测试只使用注入的 Query Factory 和内存消息流，不启动真实 Claude 进程。
 * 重点验证中止优先级、会话可信边界与终态协议，防止基础设施异常污染应用状态机。
 */
import type {
  Options,
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
import type { ClaudeMessageObserver } from "../src/infrastructure/claude/claude-message-observer.js";
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
    const executor = new ClaudeAgentSdkExecutor({ queryFactory });

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
    const executor = new ClaudeAgentSdkExecutor({ queryFactory });

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
    const executor = new ClaudeAgentSdkExecutor({ queryFactory });

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
    const executor = new ClaudeAgentSdkExecutor({
      queryFactory: () => {
        throw new Error("factory failed before init");
      },
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
    const executor = new ClaudeAgentSdkExecutor({ queryFactory });

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
    const executor = new ClaudeAgentSdkExecutor({ queryFactory });

    const outcome = await executor.run(createRequest());

    expect(outcome).toMatchObject({
      ok: false,
      kind: "protocol",
      sessionId: SESSION_ID,
      retryable: true,
    });
  });

  /*
   * 执行器必须要求 SDK 提供增量帧，并把每条消息和 stderr 原样送到观察边界。
   * 这样终端实时性不依赖应用 checkpoint，也不会因未来状态机调整再次退化为静默等待。
   */
  it("开启增量消息并实时转发全部 SDK 动态", async () => {
    const observedMessages: SDKMessage[] = [];
    const observedStderr: string[] = [];
    let includePartialMessages: boolean | undefined;
    const observer: ClaudeMessageObserver = {
      onMessage: (_context, message) => {
        observedMessages.push(message);
      },
      onStderr: (_context, data) => {
        observedStderr.push(data);
      },
    };
    const messages = [
      createTextDelta("实时文本"),
      createInitMessage(SESSION_ID),
      createSuccessResult(SESSION_ID),
    ];
    const queryFactory: AgentQueryFactory = ({ options }) => {
      includePartialMessages = options?.includePartialMessages;
      options?.stderr?.("live diagnostic\n");
      return createFakeQuery(messageStream(messages));
    };
    const executor = new ClaudeAgentSdkExecutor({
      queryFactory,
      messageObserver: observer,
    });

    const outcome = await executor.run(createRequest());

    expect(outcome.ok).toBe(true);
    expect(includePartialMessages).toBe(true);
    expect(observedMessages).toEqual(messages);
    expect(observedStderr).toEqual(["live diagnostic\n"]);
  });

  /*
   * Zod 4 默认输出 Draft 2020-12，但 Claude Code 的 --json-schema 校验器使用 Draft-07。
   * 回归测试从 SDK 公开输入边界观察最终 schema，避免方言转换退化后再次在 init 前退出。
   */
  it("向 Claude Code 传递 Draft-07 结构化输出契约", async () => {
    let outputSchema: Record<string, unknown> | undefined;
    const queryFactory: AgentQueryFactory = ({ options }) => {
      outputSchema = options?.outputFormat?.schema;
      return createFakeQuery(messageStream([
        createInitMessage(SESSION_ID),
        createSuccessResult(SESSION_ID),
      ]));
    };
    const executor = new ClaudeAgentSdkExecutor({ queryFactory });

    const outcome = await executor.run(createRequest());

    expect(outcome.ok).toBe(true);
    expect(outputSchema?.$schema).toBe(
      "http://json-schema.org/draft-07/schema#",
    );
  });

  /*
   * 自主 Worker 应继承完整 Claude Code 能力并跳过交互授权，才能自行运行测试、使用技能/MCP
   * 和拆分子任务。这里从 SDK 公开选项验证能力集合，避免后续又退化为五个文件工具。
   */
  it("写入 Worker 启用完整工具与自主权限", async () => {
    let capturedOptions: Options | undefined;
    const queryFactory: AgentQueryFactory = ({ options }) => {
      capturedOptions = options;
      return createFakeQuery(messageStream([
        createInitMessage(SESSION_ID),
        createSuccessResult(SESSION_ID),
      ]));
    };
    const executor = new ClaudeAgentSdkExecutor({ queryFactory });

    const outcome = await executor.run(createRequest());

    expect(outcome.ok).toBe(true);
    expect(capturedOptions?.tools).toEqual({
      type: "preset",
      preset: "claude_code",
    });
    expect(capturedOptions?.allowedTools).toBeUndefined();
    expect(capturedOptions?.permissionMode).toBe("bypassPermissions");
    expect(capturedOptions?.allowDangerouslySkipPermissions).toBe(true);
    expect(capturedOptions?.strictMcpConfig).toBe(false);
    expect(capturedOptions?.skills).toBe("all");
    expect(capturedOptions?.settingSources).toEqual([
      "user",
      "project",
      "local",
    ]);
  });

  /*
   * 未显式声明资源上限时，执行器不能向 SDK 注入轮数、预算或本地计时器。
   * Fake 消息流立即完成，因此测试只观察选项，不依赖真实时间或真实 Claude 进程。
   */
  it("默认不注入 Agent 轮数和预算上限", async () => {
    let capturedOptions: Options | undefined;
    const executor = new ClaudeAgentSdkExecutor({
      queryFactory: ({ options }) => {
        capturedOptions = options;
        return createFakeQuery(messageStream([
          createInitMessage(SESSION_ID),
          createSuccessResult(SESSION_ID),
        ]));
      },
    });

    const outcome = await executor.run(withoutResourceLimits(createRequest()));

    expect(outcome.ok).toBe(true);
    expect(capturedOptions?.maxTurns).toBeUndefined();
    expect(capturedOptions?.maxBudgetUsd).toBeUndefined();
  });

  /*
   * 子进程在 init 前退出时通常只有 stderr 包含根因，执行器必须把它带回稳定失败结果。
   * 测试使用注入回调模拟诊断输出，不启动真实 Claude 进程或读取用户配置。
   */
  it("执行异常时保留 Claude 子进程 stderr", async () => {
    const queryFactory: AgentQueryFactory = ({ options }) => {
      options?.stderr?.("Not logged in · Please run /login\n");
      return createFakeQuery(failingMessageStream("process exited with code 1"));
    };
    const executor = new ClaudeAgentSdkExecutor({ queryFactory });

    const outcome = await executor.run(createRequest());

    expect(outcome).toMatchObject({
      ok: false,
      kind: "execution",
    });
    if (outcome.ok) {
      throw new Error("测试期望执行器返回失败结果");
    }
    expect(outcome.message).toContain("process exited with code 1");
    expect(outcome.message).toContain("Not logged in");
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
 * exactOptionalPropertyTypes 要求“无限制”通过省略字段表达，而不是显式写入 undefined。
 * 测试辅助函数集中完成字段剥离，避免每个用例复制完整 AgentRunRequest 夹具。
 */
function withoutResourceLimits<T>(
  request: AgentRunRequest<T>,
): AgentRunRequest<T> {
  const {
    maxTurns: ignoredMaxTurns,
    maxBudgetUsd: ignoredMaxBudget,
    timeoutMs: ignoredTimeout,
    ...unlimitedRequest
  } = request;
  void ignoredMaxTurns;
  void ignoredMaxBudget;
  void ignoredTimeout;
  return unlimitedRequest;
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

function createTextDelta(text: string): SDKMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text },
    },
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
