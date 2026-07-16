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
import {
  SdkClaudeConnectionSettingsResolver,
  type ClaudeConnectionSettingsResolver,
} from "./claude-connection-settings-resolver.js";

const READ_TOOLS = ["Read", "Glob", "Grep"] as const;

type ClaudeAccessOptions = Pick<
  Options,
  | "tools"
  | "allowedTools"
  | "permissionMode"
  | "allowDangerouslySkipPermissions"
  | "strictMcpConfig"
  | "mcpServers"
  | "skills"
  | "settingSources"
  | "settings"
  | "env"
  | "hooks"
>;

export interface ClaudeAgentOptionsBuilderOptions {
  readonly executionGuard?: ExecutionGuard;
  readonly connectionSettingsResolver?: ClaudeConnectionSettingsResolver;
  readonly processEnvironment?: NodeJS.ProcessEnv;
}

export class ClaudeAgentOptionsBuilder {
  private readonly executionGuard: ExecutionGuard | undefined;
  private readonly connectionSettingsResolver: ClaudeConnectionSettingsResolver;
  private readonly processEnvironment: NodeJS.ProcessEnv;

  public constructor(options: ClaudeAgentOptionsBuilderOptions = {}) {
    this.executionGuard = options.executionGuard;
    this.connectionSettingsResolver = options.connectionSettingsResolver
      ?? new SdkClaudeConnectionSettingsResolver();
    this.processEnvironment = options.processEnvironment ?? process.env;
  }

  public build<T>(
    request: AgentRunRequest<T>,
    abortController: AbortController,
    onStderr: (data: string) => void,
  ): Options | Promise<Options> {
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
    const accessOptions = this.createAccessOptions(
      request.access,
      request.cwd,
    );
    const completeOptions = (resolvedAccess: ClaudeAccessOptions): Options => ({
      abortController,
      cwd: request.cwd,
      ...resolvedAccess,
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
    });
    /*
     * Worker 不需要额外解析连接配置，保持同步构建即可立即创建 Query；只有隔离 Reviewer
     * 才等待可信设置投影。这样新增的认证边界不会改变 Worker 的中止与会话初始化时序。
     */
    return accessOptions instanceof Promise
      ? accessOptions.then(completeOptions)
      : completeOptions(accessOptions);
  }

  private createAccessOptions(
    access: AgentRunRequest<unknown>["access"],
    cwd: string,
  ): ClaudeAccessOptions | Promise<ClaudeAccessOptions> {
    /*
     * Worker 拥有完整开发能力并受系统级 PreToolUse 守卫约束；Reviewer 保持纯读取工具，
     * 同时只注入可信用户设置中的连接字段。认证配置与权限配置由此成为两个独立边界。
     */
    if (access === "write") {
      return {
        tools: { type: "preset", preset: "claude_code" },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        strictMcpConfig: false,
        skills: "all",
        settingSources: ["user", "project", "local"],
        ...(this.executionGuard === undefined
          ? {}
          : { hooks: createExecutionGuardHooks(this.executionGuard) }),
      };
    }

    return this.connectionSettingsResolver.resolve(cwd).then(
      (connectionSettings) => {
        const { env: connectionEnvironment, ...authenticationHelpers }
          = connectionSettings;
        /*
         * 令牌和网关值通过子进程环境传递，不能序列化进 --settings 命令行参数；
         * Options.env 会替换整个环境，因此必须显式合并宿主环境以保留 PATH、HOME 和配置目录。
         */
        return {
          tools: [...READ_TOOLS],
          allowedTools: [...READ_TOOLS],
          permissionMode: "dontAsk",
          strictMcpConfig: true,
          mcpServers: {},
          skills: [],
          settingSources: [],
          settings: authenticationHelpers,
          ...(connectionEnvironment === undefined
            ? {}
            : { env: { ...this.processEnvironment, ...connectionEnvironment } }),
        };
      },
    );
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
