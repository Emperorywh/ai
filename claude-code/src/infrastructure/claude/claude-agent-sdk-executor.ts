/*
 * Claude Agent SDK 适配器完整消费异步消息流，并把超时、中止、会话初始化和结构化终态映射为稳定端口。
 * SDK 消息、权限模式与 subprocess 生命周期只存在于基础设施层，应用状态机不依赖任何 SDK 私有类型。
 */
import {
  query,
  type Options,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  AgentFailureKind,
  AgentRunOutcome,
} from "../../domain/agent-result.js";
import { ConfigurationError } from "../../domain/errors.js";
import type {
  AgentExecutor,
  AgentRunRequest,
} from "../../ports/agent-executor.js";
import type {
  ClaudeMessageContext,
  ClaudeMessageObserver,
} from "./claude-message-observer.js";

const READ_TOOLS = ["Read", "Glob", "Grep"] as const;
const FORCE_CLOSE_GRACE_MS = 2_000;
const MAX_STDERR_CHARACTERS = 20_000;

export type AgentQueryFactory = (input: Parameters<typeof query>[0]) => Query;

export interface ClaudeAgentSdkExecutorOptions {
  readonly queryFactory?: AgentQueryFactory;
  readonly messageObserver?: ClaudeMessageObserver;
}

export class ClaudeAgentSdkExecutor implements AgentExecutor {
  private readonly queryFactory: AgentQueryFactory;
  private readonly messageObserver: ClaudeMessageObserver | undefined;

  /*
   * 依赖通过具名选项装配，避免测试 Query Factory 与生产终端观察器依赖位置参数顺序。
   * 未注入观察器时执行器保持纯后台行为，便于包使用者按自己的宿主环境组合输出能力。
   */
  public constructor(options: ClaudeAgentSdkExecutorOptions = {}) {
    this.queryFactory = options.queryFactory ?? query;
    this.messageObserver = options.messageObserver;
  }

  public async run<T>(
    request: AgentRunRequest<T>,
  ): Promise<AgentRunOutcome<T>> {
    if (isSignalAborted(request.signal)) {
      return this.failure("aborted", "Agent 在启动前被外部中止", undefined, 0, 0, false);
    }

    const controller = new AbortController();
    const abortState: { reason?: "timeout" | "external" } = {};
    let forceCloseTimer: NodeJS.Timeout | undefined;
    let activeQuery: Query | undefined;
    let streamCompleted = false;
    let initializedSessionId: string | undefined;
    let observerError: unknown;
    let capturedStderr = "";
    const messageContext: ClaudeMessageContext = {
      taskId: request.taskId,
      attemptKind: request.attemptKind,
    };

    const abortQuery = (reason: "timeout" | "external"): void => {
      if (abortState.reason !== undefined) {
        return;
      }
      abortState.reason = reason;
      controller.abort();
      forceCloseTimer = setTimeout(() => closeQuery(activeQuery), FORCE_CLOSE_GRACE_MS);
    };
    /*
     * 会话限制是显式选择而不是编排器默认值。未声明 timeoutMs 时只响应外部中断，
     * 长任务可以持续工作到产出结构化终态，不会因隐藏的基础设施计时器被截断。
     */
    const timeout = request.timeoutMs === undefined
      ? undefined
      : setTimeout(() => abortQuery("timeout"), request.timeoutMs);
    const externalAbortHandler = (): void => abortQuery("external");
    request.signal?.addEventListener("abort", externalAbortHandler, { once: true });
    if (isSignalAborted(request.signal)) {
      abortQuery("external");
    }

    try {
      const options = this.buildOptions(
        request,
        controller,
        (data) => {
          capturedStderr = appendCapturedStderr(capturedStderr, data);
          this.observeStderr(messageContext, data);
        },
      );
      if (readAbortReason(abortState) === "external") {
        return this.failure("aborted", "Agent 在启动前被外部中止", undefined, 0, 0, false);
      }

      activeQuery = this.queryFactory({ prompt: request.prompt, options });
      let terminalResult: SDKResultMessage | undefined;

      for await (const message of activeQuery) {
        this.observeMessage(messageContext, message);
        if (message.type === "system" && message.subtype === "init") {
          initializedSessionId = message.session_id;
          try {
            await request.onSessionInitialized?.(message.session_id);
          } catch (error) {
            observerError = error;
            throw error;
          }
        }
        if (message.type === "result") {
          terminalResult = message;
        }
      }
      streamCompleted = true;

      const terminalAbortReason = readAbortReason(abortState);
      if (terminalAbortReason !== undefined) {
        return this.failure(
          terminalAbortReason === "external" ? "aborted" : "timeout",
          terminalAbortReason === "external" ? "Agent 被外部中止" : "Agent 执行超时",
          terminalResult?.session_id ?? initializedSessionId,
          terminalResult?.total_cost_usd ?? 0,
          terminalResult?.num_turns ?? 0,
          terminalAbortReason === "timeout",
        );
      }

      if (terminalResult === undefined) {
        return this.failure(
          "protocol",
          "Agent 消息流结束但没有 result 终态",
          initializedSessionId,
          0,
          0,
          true,
        );
      }

      if (initializedSessionId === undefined) {
        initializedSessionId = terminalResult.session_id;
        try {
          await request.onSessionInitialized?.(terminalResult.session_id);
        } catch (error) {
          observerError = error;
          throw error;
        }
      }
      if (terminalResult.subtype !== "success") {
        return this.mapSdkFailure(terminalResult);
      }

      const parsed = request.resultSchema.safeParse(terminalResult.structured_output);
      if (!parsed.success) {
        return this.failure(
          "structured_output",
          `Agent 结构化输出无效：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
          terminalResult.session_id,
          terminalResult.total_cost_usd,
          terminalResult.num_turns,
          true,
        );
      }

      return {
        ok: true,
        sessionId: terminalResult.session_id,
        data: parsed.data,
        costUsd: terminalResult.total_cost_usd,
        turns: terminalResult.num_turns,
      };
    } catch (error) {
      if (observerError !== undefined) {
        throw toError(observerError);
      }
      if (error instanceof ConfigurationError) {
        throw error;
      }
      const failureAbortReason = readAbortReason(abortState);
      const kind: AgentFailureKind = failureAbortReason === "timeout"
        ? "timeout"
        : failureAbortReason === "external"
          ? "aborted"
          : "execution";
      return this.failure(
        kind,
        describeExecutionError(error, capturedStderr),
        initializedSessionId,
        0,
        0,
        kind !== "aborted",
      );
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (forceCloseTimer !== undefined) {
        clearTimeout(forceCloseTimer);
      }
      request.signal?.removeEventListener("abort", externalAbortHandler);
      if (!streamCompleted) {
        closeQuery(activeQuery);
      }
    }
  }

  private buildOptions<T>(
    request: AgentRunRequest<T>,
    abortController: AbortController,
    onStderr: (data: string) => void,
  ): Options {
    if (
      request.sessionId !== undefined
      && request.resumeSessionId !== undefined
    ) {
      throw new ConfigurationError("新 sessionId 与 resumeSessionId 不能同时提供");
    }
    /*
     * Claude Code 当前使用 Draft-07 校验 --json-schema；Zod 4 默认生成 Draft 2020-12，
     * 会让子进程在 session init 前因无法解析元 schema 而退出。方言转换属于 SDK 适配职责，
     * 领域层仍只维护唯一的 Zod 输出契约，不复制第二套 JSON Schema。
     */
    const outputSchema = z.toJSONSchema(request.resultSchema, {
      target: "draft-07",
    });
    const systemRules = request.access === "write"
      ? "你是单 TASK 自主 Worker。只执行当前任务；可以自主使用终端、技能、MCP 和子 Agent 完成分析、编码与非浏览器验证。不要启动浏览器，不要 push 或部署。"
      : "你是独立只读 Reviewer。不得编辑文件、创建子 Agent、启动浏览器或执行部署。";

    /*
     * 写入 Worker 使用 Claude Code 的完整工具面与本机/项目扩展，并明确绕过交互式授权，
     * 让它可以自行运行命令、调用技能和组织子 Agent。系统不再注入路径 Hook 或命令门禁；
     * Reviewer 继续保持最小只读能力，以独立判断候选而不削减 Worker 的实现空间。
     */
    const accessOptions: Pick<
      Options,
      | "tools"
      | "allowedTools"
      | "permissionMode"
      | "allowDangerouslySkipPermissions"
      | "strictMcpConfig"
      | "mcpServers"
      | "skills"
      | "settingSources"
    > = request.access === "write"
      ? {
          tools: { type: "preset", preset: "claude_code" },
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          strictMcpConfig: false,
          skills: "all",
          settingSources: ["user", "project", "local"],
        }
      : {
          tools: [...READ_TOOLS],
          allowedTools: [...READ_TOOLS],
          permissionMode: "dontAsk",
          strictMcpConfig: true,
          mcpServers: {},
          skills: [],
          settingSources: ["user"],
        };

    return {
      abortController,
      cwd: request.cwd,
      ...accessOptions,
      stderr: onStderr,
      persistSession: true,
      ...(request.maxTurns === undefined
        ? {}
        : { maxTurns: request.maxTurns }),
      ...(request.maxBudgetUsd === undefined
        ? {}
        : { maxBudgetUsd: request.maxBudgetUsd }),
      model: request.model,
      effort: request.effort,
      includePartialMessages: true,
      outputFormat: {
        type: "json_schema",
        schema: outputSchema,
      },
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: systemRules,
      },
      title: `${request.taskId}-${request.attemptKind}`,
      ...(request.resumeSessionId !== undefined
        ? { resume: request.resumeSessionId }
        : request.sessionId !== undefined
          ? { sessionId: request.sessionId }
          : {}),
    };
  }

  private mapSdkFailure<T>(
    result: Exclude<SDKResultMessage, { subtype: "success" }>,
  ): AgentRunOutcome<T> {
    const mapping: Record<typeof result.subtype, AgentFailureKind> = {
      error_during_execution: "execution",
      error_max_turns: "max_turns",
      error_max_budget_usd: "max_budget",
      error_max_structured_output_retries: "structured_output",
    };
    return this.failure(
      mapping[result.subtype],
      result.errors.join("；") || result.terminal_reason || result.subtype,
      result.session_id,
      result.total_cost_usd,
      result.num_turns,
      result.subtype !== "error_max_budget_usd",
    );
  }

  private failure<T>(
    kind: AgentFailureKind,
    message: string,
    sessionId: string | undefined,
    costUsd: number,
    turns: number,
    retryable: boolean,
  ): AgentRunOutcome<T> {
    return {
      ok: false,
      ...(sessionId === undefined ? {} : { sessionId }),
      kind,
      message,
      costUsd,
      turns,
      retryable,
    };
  }

  /*
   * 实时输出属于旁路观察能力，观察器故障不能改变 Agent 的业务结果或 checkpoint 语义。
   * 失败会立即写入 stderr，后续 SDK 消息仍由主循环持续消费。
   */
  private observeMessage(
    context: ClaudeMessageContext,
    message: SDKMessage,
  ): void {
    try {
      this.messageObserver?.onMessage(context, message);
    } catch (error) {
      reportObserverFailure(error);
    }
  }

  private observeStderr(context: ClaudeMessageContext, data: string): void {
    try {
      this.messageObserver?.onStderr(context, data);
    } catch (error) {
      reportObserverFailure(error);
    }
  }
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function readAbortReason(
  state: { readonly reason?: "timeout" | "external" },
): "timeout" | "external" | undefined {
  return state.reason;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function closeQuery(activeQuery: Query | undefined): void {
  try {
    activeQuery?.close();
  } catch {
    // Query 已处于异常清理路径，关闭失败不能覆盖原始 Agent 结果。
  }
}

function reportObserverFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  try {
    process.stderr.write(`Claude 实时输出失败：${message}\n`);
  } catch {
    // stderr 本身不可写时无法继续报告，但 Agent 主流程仍必须保持可运行。
  }
}

/*
 * 子进程 stderr 只保留尾部，既能记录认证和参数错误，也避免异常输出无限扩大内存与状态正文。
 * 默认不启用 Claude debug，因此这里捕获的是正常错误诊断，而不是包含大量内部上下文的调试日志。
 */
function appendCapturedStderr(current: string, data: string): string {
  const next = current + data;
  return next.length <= MAX_STDERR_CHARACTERS
    ? next
    : next.slice(-MAX_STDERR_CHARACTERS);
}

/*
 * SDK 有时只抛出笼统的进程退出码，而真实原因位于 stderr；两者合并后写入 attempt summary。
 * 若 SDK 错误已经包含相同诊断则不重复追加，保持终端和状态文件中的错误可读。
 */
function describeExecutionError(error: unknown, capturedStderr: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const stderr = capturedStderr.trim();
  if (stderr.length === 0 || message.includes(stderr)) {
    return message;
  }
  return `${message}\nClaude Code stderr:\n${stderr}`;
}
