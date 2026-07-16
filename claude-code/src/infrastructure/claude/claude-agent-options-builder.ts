/*
 * ClaudeAgentOptionsBuilder 只负责把稳定 Agent 端口请求翻译为 Claude SDK Options。
 * 工具能力、设置隔离、JSON Schema 方言与 Hook 协议集中在此，消息流执行器不再持有配置细节。
 */
import {
  type HookCallback,
  type Options,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { ConfigurationError } from "../../domain/errors.js";
import type { AgentRunRequest } from "../../ports/agent-executor.js";
import type { ExecutionGuard } from "../../ports/execution-guard.js";

const READ_TOOLS = ["Read", "Glob", "Grep"] as const;

export class ClaudeAgentOptionsBuilder {
  public constructor(private readonly executionGuard?: ExecutionGuard) {}

  public build<T>(
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
     * Claude Code 使用 Draft-07 校验 --json-schema，领域层仍只维护唯一 Zod 契约。
     * 方言转换属于 SDK 适配职责，不能在应用层复制第二份结构化结果 Schema。
     */
    const outputSchema = z.toJSONSchema(request.resultSchema, {
      target: "draft-07",
    });
    const systemRules = request.access === "write"
      ? "你是单 TASK 自主 Worker。只执行当前任务；可以自主使用终端、技能、MCP 和子 Agent 完成分析、编码与非浏览器验证。不要执行 Git 写操作，不要启动浏览器或部署。"
      : "你是独立只读 Reviewer。不得编辑文件、创建子 Agent、启动浏览器或执行部署。";
    const accessOptions = this.createAccessOptions(request.access);

    return {
      abortController,
      cwd: request.cwd,
      ...accessOptions,
      stderr: onStderr,
      persistSession: true,
      ...(request.maxTurns === undefined ? {} : { maxTurns: request.maxTurns }),
      ...(request.maxBudgetUsd === undefined
        ? {}
        : { maxBudgetUsd: request.maxBudgetUsd }),
      model: request.model,
      effort: request.effort,
      includePartialMessages: true,
      outputFormat: { type: "json_schema", schema: outputSchema },
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

  private createAccessOptions(
    access: AgentRunRequest<unknown>["access"],
  ): Pick<
    Options,
    | "tools"
    | "allowedTools"
    | "permissionMode"
    | "allowDangerouslySkipPermissions"
    | "strictMcpConfig"
    | "mcpServers"
    | "skills"
    | "settingSources"
    | "hooks"
  > {
    /*
     * Worker 拥有完整开发能力但受系统级 PreToolUse 守卫约束；Reviewer 使用空设置源与纯读取工具。
     * 两种能力面在单一工厂中互斥构造，不存在后续字段覆盖造成的权限混合。
     */
    return access === "write"
      ? {
          tools: { type: "preset", preset: "claude_code" },
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          strictMcpConfig: false,
          skills: "all",
          settingSources: ["user", "project", "local"],
          ...(this.executionGuard === undefined
            ? {}
            : { hooks: createExecutionGuardHooks(this.executionGuard) }),
        }
      : {
          tools: [...READ_TOOLS],
          allowedTools: [...READ_TOOLS],
          permissionMode: "dontAsk",
          strictMcpConfig: true,
          mcpServers: {},
          skills: [],
          settingSources: [],
        };
  }
}

/*
 * Claude Hook 协议只在 SDK 基础设施中完成转换。
 * 应用守卫只返回允许/拒绝，不能依赖 hookSpecificOutput 或权限枚举。
 */
function createExecutionGuardHooks(
  guard: ExecutionGuard,
): NonNullable<Options["hooks"]> {
  const callback: HookCallback = (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return Promise.resolve({ continue: true });
    }
    const decision = guard.inspect(input.tool_name, input.tool_input);
    if (decision.allowed) {
      return Promise.resolve({ continue: true });
    }
    return Promise.resolve({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: decision.reason ?? "系统执行策略拒绝该工具调用",
      },
    });
  };
  return { PreToolUse: [{ hooks: [callback] }] };
}
