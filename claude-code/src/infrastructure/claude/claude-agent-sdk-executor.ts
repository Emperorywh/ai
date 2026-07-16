/*
 * Claude Agent SDK 适配器完整消费异步消息流，并把超时、中止、会话初始化和结构化终态映射为稳定端口。
 * SDK 消息、权限模式与 subprocess 生命周期只存在于基础设施层，应用状态机不依赖任何 SDK 私有类型。
 */
import {
  query,
  type Query,
  type SDKAssistantMessageError,
  type SDKMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentFailureKind,
  AgentRunOutcome,
  AgentRunTelemetry,
} from "../../domain/agent-result.js";
import {
  ConfigurationError,
  InfrastructureError,
} from "../../domain/errors.js";
import type {
  AgentExecutor,
  AgentRunRequest,
} from "../../ports/agent-executor.js";
import type { ExecutionGuard } from "../../ports/execution-guard.js";
import type {
  ClaudeMessageContext,
  ClaudeMessageObserver,
} from "./claude-message-observer.js";
import { ClaudeAgentOptionsBuilder } from "./claude-agent-options-builder.js";
import type { ClaudeConnectionSettingsResolver } from "./claude-connection-settings-resolver.js";

const FORCE_CLOSE_GRACE_MS = 2_000;
const MAX_STDERR_CHARACTERS = 20_000;

export type AgentQueryFactory = (input: Parameters<typeof query>[0]) => Query;

export interface ClaudeAgentSdkExecutorOptions {
  readonly queryFactory?: AgentQueryFactory;
  readonly messageObserver?: ClaudeMessageObserver;
  readonly executionGuard?: ExecutionGuard;
  readonly connectionSettingsResolver?: ClaudeConnectionSettingsResolver;
  readonly processEnvironment?: NodeJS.ProcessEnv;
}

export class ClaudeAgentSdkExecutor implements AgentExecutor {
  private readonly queryFactory: AgentQueryFactory;
  private readonly messageObserver: ClaudeMessageObserver | undefined;
  private readonly optionsBuilder: ClaudeAgentOptionsBuilder;

  /*
   * 依赖通过具名选项装配，避免测试 Query Factory 与生产终端观察器依赖位置参数顺序。
   * 未注入观察器时执行器保持纯后台行为，便于包使用者按自己的宿主环境组合输出能力。
   */
  public constructor(options: ClaudeAgentSdkExecutorOptions = {}) {
    this.queryFactory = options.queryFactory ?? query;
    this.messageObserver = options.messageObserver;
    this.optionsBuilder = new ClaudeAgentOptionsBuilder({
      ...(options.executionGuard === undefined
        ? {}
        : { executionGuard: options.executionGuard }),
      ...(options.connectionSettingsResolver === undefined
        ? {}
        : { connectionSettingsResolver: options.connectionSettingsResolver }),
      ...(options.processEnvironment === undefined
        ? {}
        : { processEnvironment: options.processEnvironment }),
    });
  }

  public async run<T>(
    request: AgentRunRequest<T>,
  ): Promise<AgentRunOutcome<T>> {
    const startedAt = performance.now();
    let resolvedModel: string | undefined;
    let apiRetryCount = 0;
    let apiRetryDelayMs = 0;
    const toolUseIds = new Set<string>();
    const createTelemetry = (): AgentRunTelemetry => ({
      requestedModel: request.model,
      ...(resolvedModel === undefined ? {} : { resolvedModel }),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      apiRetryCount,
      apiRetryDelayMs,
      toolCalls: toolUseIds.size,
    });
    const fail = (
      kind: AgentFailureKind,
      message: string,
      sessionId: string | undefined,
      costUsd: number,
      turns: number,
      retryable: boolean,
    ): AgentRunOutcome<T> => this.failure(
      kind,
      message,
      sessionId,
      costUsd,
      turns,
      retryable,
      createTelemetry(),
    );

    if (isSignalAborted(request.signal)) {
      return fail("aborted", "Agent 在启动前被外部中止", undefined, 0, 0, false);
    }

    const controller = new AbortController();
    const abortState: { reason?: "timeout" | "external" } = {};
    let forceCloseTimer: NodeJS.Timeout | undefined;
    let activeQuery: Query | undefined;
    let streamCompleted = false;
    let initializedSessionId: string | undefined;
    let assistantMessageError: SDKAssistantMessageError | undefined;
    let checkpointError: unknown;
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
      const optionsResult = this.optionsBuilder.build(
        request,
        controller,
        (data) => {
          capturedStderr = appendCapturedStderr(capturedStderr, data);
          this.observeStderr(messageContext, data);
        },
      );
      const options = optionsResult instanceof Promise
        ? await optionsResult
        : optionsResult;
      if (readAbortReason(abortState) === "external") {
        return fail("aborted", "Agent 在启动前被外部中止", undefined, 0, 0, false);
      }

      activeQuery = this.queryFactory({ prompt: request.prompt, options });
      let terminalResult: SDKResultMessage | undefined;

      for await (const message of activeQuery) {
        this.observeMessage(messageContext, message);
        collectToolUseIds(message, toolUseIds);
        if (message.type === "assistant") {
          assistantMessageError = message.error;
        }
        if (message.type === "system" && message.subtype === "api_retry") {
          apiRetryCount += 1;
          apiRetryDelayMs += message.retry_delay_ms;
        }
        if (message.type === "system" && message.subtype === "init") {
          initializedSessionId = message.session_id;
          resolvedModel = message.model;
          try {
            await request.onSessionInitialized?.({
              sessionId: message.session_id,
              resolvedModel: message.model,
            });
          } catch (error) {
            checkpointError = error;
            throw error;
          }
          if (message.model !== request.expectedResolvedModel) {
            closeQuery(activeQuery);
            return fail(
              "model_mismatch",
              `实际模型与 attempt 请求不一致：期望 ${request.expectedResolvedModel}，实际 ${message.model}`,
              message.session_id,
              0,
              0,
              false,
            );
          }
        }
        if (message.type === "result") {
          terminalResult = message;
        }
      }
      streamCompleted = true;

      const terminalAbortReason = readAbortReason(abortState);
      if (terminalAbortReason !== undefined) {
        return fail(
          terminalAbortReason === "external" ? "aborted" : "timeout",
          terminalAbortReason === "external" ? "Agent 被外部中止" : "Agent 执行超时",
          terminalResult?.session_id ?? initializedSessionId,
          terminalResult?.total_cost_usd ?? 0,
          terminalResult?.num_turns ?? 0,
          terminalAbortReason === "timeout",
        );
      }

      if (terminalResult === undefined) {
        return fail(
          "protocol",
          "Agent 消息流结束但没有 result 终态",
          initializedSessionId,
          0,
          0,
          true,
        );
      }

      if (initializedSessionId === undefined || resolvedModel === undefined) {
        return fail(
          "protocol",
          "Agent 返回 result 前没有可信的 system/init 模型握手",
          terminalResult.session_id,
          terminalResult.total_cost_usd,
          terminalResult.num_turns,
          true,
        );
      }
      if (terminalResult.session_id !== initializedSessionId) {
        return fail(
          "protocol",
          `Agent result sessionId 与 init 不一致：init ${initializedSessionId}，result ${terminalResult.session_id}`,
          initializedSessionId,
          terminalResult.total_cost_usd,
          terminalResult.num_turns,
          true,
        );
      }
      /*
       * Claude Code 可能在 assistant 帧报告 authentication_failed，随后仍发送 success result，
       * 甚至在迭代器收尾时再抛异常。认证事实必须优先于表面的 result subtype，避免误判成功或重试。
       */
      const terminalDiagnostic = terminalResult.subtype === "success"
        ? capturedStderr
        : [
            ...terminalResult.errors,
            terminalResult.terminal_reason ?? "",
            capturedStderr,
          ].filter(Boolean).join("\n");
      if (isAuthenticationFailure(assistantMessageError, terminalDiagnostic)) {
        return fail(
          "authentication",
          describeAuthenticationFailure(
            terminalDiagnostic || assistantMessageError || "",
          ),
          terminalResult.session_id,
          terminalResult.total_cost_usd,
          terminalResult.num_turns,
          false,
        );
      }
      if (terminalResult.subtype !== "success") {
        return this.mapSdkFailure(terminalResult, createTelemetry());
      }

      const parsed = request.resultSchema.safeParse(terminalResult.structured_output);
      if (!parsed.success) {
        return fail(
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
        telemetry: createTelemetry(),
      };
    } catch (error) {
      if (checkpointError !== undefined) {
        throw toError(checkpointError);
      }
      if (error instanceof ConfigurationError) {
        throw error;
      }
      const failureAbortReason = readAbortReason(abortState);
      /*
       * spawn 在 system/init 之前失败，表示 Claude Code 进程根本没有建立，TASK 代码也尚未执行。
       * 这类宿主安装或可执行文件故障必须离开 Agent repair 预算，由 Run 恢复边界单独收敛。
       */
      if (
        failureAbortReason === undefined
        && initializedSessionId === undefined
        && isProcessLaunchError(error)
      ) {
        throw new InfrastructureError(
          describeProcessLaunchError(error, capturedStderr),
          { cause: error },
        );
      }
      const executionMessage = describeExecutionError(error, capturedStderr);
      const authenticationFailed = failureAbortReason === undefined
        && isAuthenticationFailure(assistantMessageError, executionMessage);
      const kind: AgentFailureKind = authenticationFailed
        ? "authentication"
        : failureAbortReason === "timeout"
        ? "timeout"
        : failureAbortReason === "external"
          ? "aborted"
          : "execution";
      return fail(
        kind,
        authenticationFailed
          ? describeAuthenticationFailure(executionMessage)
          : executionMessage,
        initializedSessionId,
        0,
        0,
        kind !== "aborted" && kind !== "authentication",
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

  private mapSdkFailure<T>(
    result: Exclude<SDKResultMessage, { subtype: "success" }>,
    telemetry: AgentRunTelemetry,
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
      telemetry,
    );
  }

  private failure<T>(
    kind: AgentFailureKind,
    message: string,
    sessionId: string | undefined,
    costUsd: number,
    turns: number,
    retryable: boolean,
    telemetry: AgentRunTelemetry,
  ): AgentRunOutcome<T> {
    return {
      ok: false,
      ...(sessionId === undefined ? {} : { sessionId }),
      kind,
      message,
      costUsd,
      turns,
      retryable,
      telemetry,
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

/*
 * 工具计数按稳定 tool_use id 去重，SDK 重放完整 assistant 消息时不会放大指标。
 * 这里只收集遥测，不改变观察器是否展示对应消息。
 */
function collectToolUseIds(
  message: SDKMessage,
  toolUseIds: Set<string>,
): void {
  if (message.type !== "assistant") {
    return;
  }
  for (const block of message.message.content) {
    if (block.type === "tool_use") {
      toolUseIds.add(block.id);
    }
  }
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

/*
 * Node 的 child_process 错误以 syscall=spawn* 提供稳定的启动阶段事实。
 * 不按 message 猜测普通执行错误，避免把 Agent 初始化协议故障错误提升为宿主基础设施故障。
 */
function isProcessLaunchError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const syscall = (error as { readonly syscall?: unknown }).syscall;
  return typeof syscall === "string" && syscall.startsWith("spawn");
}

/*
 * 启动诊断只投影 code、syscall 和 executable path，既足以定位 ENOENT/EFTYPE/EACCES，
 * 又不会把可能包含连接设置或提示词的完整 spawn 参数写入状态与终端日志。
 */
function describeProcessLaunchError(
  error: unknown,
  capturedStderr: string,
): string {
  const executionMessage = describeExecutionError(error, capturedStderr);
  if (typeof error !== "object" || error === null) {
    return executionMessage;
  }
  const diagnosticFields = [
    readStringProperty(error, "code", "code"),
    readStringProperty(error, "syscall", "syscall"),
    readStringProperty(error, "path", "path"),
  ].filter((field): field is string => field !== undefined);
  const diagnostic = diagnosticFields.length === 0
    ? ""
    : `（${diagnosticFields.join("，")}）`;
  return [
    `Claude Code 子进程启动失败${diagnostic}：${executionMessage}`,
    "会话尚未初始化，TASK 未开始执行。请确认 Apex 安装未在运行中被替换、Claude Agent SDK 原生 CLI 文件完整，然后恢复该 Run。",
  ].join("\n");
}

/*
 * Error 的平台扩展字段不属于标准 Error 类型，统一通过反射读取并限制为字符串。
 * 该边界避免基础设施适配器向领域层暴露 NodeJS.ErrnoException 私有形状。
 */
function readStringProperty(
  value: object,
  property: string,
  label: string,
): string | undefined {
  const field = (value as Readonly<Record<string, unknown>>)[property];
  return typeof field === "string" && field.length > 0
    ? `${label}=${field}`
    : undefined;
}

/*
 * assistant.error 是首选的稳定协议事实；文本匹配只覆盖 init 前退出、尚未产生 assistant 帧的场景。
 * 认证失败依赖用户重新配置凭据，重复创建相同会话不会恢复，因此必须明确标记为不可重试。
 */
function isAuthenticationFailure(
  assistantError: SDKAssistantMessageError | undefined,
  diagnostic: string,
): boolean {
  if (
    assistantError === "authentication_failed"
    || assistantError === "oauth_org_not_allowed"
  ) {
    return true;
  }
  return /authentication_failed|oauth_org_not_allowed|not logged in|please run \/login/iu
    .test(diagnostic);
}

/*
 * 统一认证失败摘要，确保状态文件和终端事件都能给出直接可操作的根因。
 * 原始诊断保留在摘要中，便于区分未登录、组织限制和认证辅助命令故障。
 */
function describeAuthenticationFailure(diagnostic: string): string {
  const detail = diagnostic.trim();
  return detail.length === 0
    ? "Claude Code 认证失败，请检查用户级认证配置或重新登录"
    : `Claude Code 认证失败：${detail}`;
}
