/*
 * ConsoleClaudeMessageObserver 把 Claude 的增量文本、工具调用、工具结果与系统状态实时投影到终端。
 * 协议帧解析和终端排版集中在这里，执行器只负责转发消息，应用层不感知 SDK 展示细节。
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  ClaudeMessageContext,
  ClaudeMessageObserver,
} from "./claude-message-observer.js";

type ConsoleWriter = (content: string) => void;

const MAX_INLINE_DETAIL_CHARACTERS = 400;

export class ConsoleClaudeMessageObserver implements ClaudeMessageObserver {
  private assistantTextOpen = false;
  private streamedAssistantText = false;
  private readonly toolNames = new Map<string, string>();

  public constructor(
    private readonly stdout: ConsoleWriter = (content) => {
      process.stdout.write(content);
    },
    private readonly stderr: ConsoleWriter = (content) => {
      process.stderr.write(content);
    },
  ) {}

  public onMessage(context: ClaudeMessageContext, message: SDKMessage): void {
    if (message.type === "stream_event") {
      this.renderStreamEvent(context, message.event);
      return;
    }
    if (message.type === "assistant") {
      this.renderAssistantMessage(context, message);
      return;
    }
    if (message.type === "user") {
      this.renderUserMessage(context, message);
      return;
    }
    if (message.type === "result") {
      this.renderResult(context, message);
      return;
    }
    if (message.type === "tool_progress") {
      this.writeLine(
        context,
        `工具 ${message.tool_name} 已运行 ${message.elapsed_time_seconds.toFixed(1)} 秒`,
      );
      return;
    }
    if (message.type === "tool_use_summary") {
      this.writeLine(context, `工具摘要：${message.summary}`);
      return;
    }
    if (message.type === "auth_status") {
      const detail = [...message.output, ...(message.error === undefined ? [] : [message.error])]
        .filter(Boolean)
        .join("；");
      this.writeLine(
        context,
        `认证${message.isAuthenticating ? "进行中" : "已结束"}${detail.length === 0 ? "" : `：${detail}`}`,
      );
      return;
    }
    if (message.type === "system") {
      this.renderSystemMessage(context, message);
      return;
    }

    this.writeLine(
      context,
      `Claude 事件 ${message.type}：${summarizeUnknown(message)}`,
    );
  }

  public onStderr(context: ClaudeMessageContext, data: string): void {
    if (data.length === 0) {
      return;
    }
    this.closeAssistantText();
    const prefix = `${formatContext(context)} Claude stderr：`;
    const normalized = data.replaceAll("\r\n", "\n").trimEnd();
    this.stderr(`${prefix}${normalized.replaceAll("\n", `\n${prefix}`)}\n`);
  }

  /*
   * 增量流只直接打印用户可感知的文本 token；thinking 正文不外显，避免把模型内部推理当作结果。
   * 工具输入在完整 assistant 消息到达时统一打印，防止 input_json_delta 产生不可读的碎片 JSON。
   */
  private renderStreamEvent(
    context: ClaudeMessageContext,
    event: unknown,
  ): void {
    const eventRecord = asRecord(event);
    if (eventRecord?.type !== "content_block_delta") {
      return;
    }
    const delta = asRecord(eventRecord.delta);
    if (delta?.type !== "text_delta" || typeof delta.text !== "string") {
      return;
    }

    if (!this.assistantTextOpen) {
      this.stdout(`${formatContext(context)} Claude：`);
      this.assistantTextOpen = true;
    }
    this.stdout(delta.text);
    this.streamedAssistantText = true;
  }

  private renderAssistantMessage(
    context: ClaudeMessageContext,
    message: Extract<SDKMessage, { type: "assistant" }>,
  ): void {
    this.closeAssistantText();
    const content = message.message.content;
    if (!this.streamedAssistantText) {
      for (const block of content) {
        if (block.type === "text" && block.text.length > 0) {
          this.writeLine(context, `Claude：${block.text}`);
        }
      }
    }

    for (const block of content) {
      if (block.type !== "tool_use") {
        continue;
      }
      this.toolNames.set(block.id, block.name);
      const detail = summarizeToolInput(block.input);
      this.writeLine(
        context,
        `调用工具 ${block.name}${detail.length === 0 ? "" : `：${detail}`}`,
      );
    }
    if (message.error !== undefined) {
      this.writeLine(context, `Claude 消息错误：${message.error}`);
    }
    this.streamedAssistantText = false;
  }

  private renderUserMessage(
    context: ClaudeMessageContext,
    message: Extract<SDKMessage, { type: "user" }>,
  ): void {
    const content = message.message.content;
    if (typeof content === "string") {
      if (content.length > 0 && message.isSynthetic !== true) {
        this.writeLine(context, `会话输入：${truncateInline(content)}`);
      }
      return;
    }

    for (const block of content) {
      if (block.type !== "tool_result") {
        continue;
      }
      const toolName = this.toolNames.get(block.tool_use_id) ?? block.tool_use_id;
      const preview = summarizeToolResult(block.content);
      this.writeLine(
        context,
        `工具 ${toolName} ${block.is_error === true ? "失败" : "完成"}${preview.length === 0 ? "" : `：${preview}`}`,
      );
    }
  }

  private renderResult(
    context: ClaudeMessageContext,
    message: Extract<SDKMessage, { type: "result" }>,
  ): void {
    this.closeAssistantText();
    const metrics = `${message.num_turns} 轮，$${message.total_cost_usd.toFixed(4)}`;
    if (message.subtype === "success") {
      this.writeLine(context, `Claude 会话成功（${metrics}）`);
      return;
    }
    this.writeLine(
      context,
      `Claude 会话失败 ${message.subtype}（${metrics}）：${message.errors.join("；") || message.terminal_reason || "未提供原因"}`,
    );
  }

  /*
   * system 消息使用稳定的人类可读摘要；未知 subtype 仍会输出紧凑协议内容，
   * 这样 SDK 新增状态时不会再次形成长时间无终端反馈的黑洞。
   */
  private renderSystemMessage(
    context: ClaudeMessageContext,
    message: Extract<SDKMessage, { type: "system" }>,
  ): void {
    switch (message.subtype) {
      case "init":
        this.writeLine(
          context,
          `Claude Code ${message.claude_code_version} 已初始化，模型 ${message.model}`,
        );
        return;
      case "status":
        this.writeLine(context, `Claude 状态：${message.status ?? "空闲"}`);
        return;
      case "thinking_tokens":
        this.writeLine(context, `Claude 正在推理，约 ${message.estimated_tokens} tokens`);
        return;
      case "api_retry":
        this.writeLine(
          context,
          `API 请求重试 ${message.attempt}/${message.max_retries}，${message.retry_delay_ms}ms 后继续（${message.error}）`,
        );
        return;
      case "compact_boundary":
        this.writeLine(
          context,
          `上下文压缩完成：${message.compact_metadata.pre_tokens} tokens`,
        );
        return;
      case "session_state_changed":
        this.writeLine(context, `会话状态：${message.state}`);
        return;
      case "informational":
        this.writeLine(context, `Claude 提示：${message.content}`);
        return;
      case "notification":
        this.writeLine(context, `Claude 通知：${message.text}`);
        return;
      case "permission_denied":
        this.writeLine(
          context,
          `工具 ${message.tool_name} 权限被拒绝：${message.message}`,
        );
        return;
      default:
        this.writeLine(
          context,
          `Claude 系统事件 ${message.subtype}：${summarizeUnknown(message)}`,
        );
    }
  }

  private writeLine(context: ClaudeMessageContext, content: string): void {
    this.closeAssistantText();
    this.stdout(`${formatContext(context)} ${content}\n`);
  }

  private closeAssistantText(): void {
    if (!this.assistantTextOpen) {
      return;
    }
    this.stdout("\n");
    this.assistantTextOpen = false;
  }
}

function formatContext(context: ClaudeMessageContext): string {
  return `[${context.taskId}/${context.attemptKind}]`;
}

function summarizeToolInput(input: unknown): string {
  const record = asRecord(input);
  if (record === undefined) {
    return summarizeUnknown(input);
  }
  const keys = ["file_path", "path", "pattern", "glob", "offset", "limit"];
  const fields = keys.flatMap((key) => {
    const value = record[key];
    return typeof value === "string" || typeof value === "number"
      ? [`${key}=${String(value)}`]
      : [];
  });
  return fields.length > 0 ? fields.join(", ") : summarizeUnknown(input);
}

function summarizeToolResult(content: unknown): string {
  if (typeof content === "string") {
    return truncateInline(content);
  }
  if (!Array.isArray(content)) {
    return summarizeUnknown(content);
  }
  const text = content.flatMap((item) => {
    const record = asRecord(item);
    return record?.type === "text" && typeof record.text === "string"
      ? [record.text]
      : [];
  }).join(" ");
  return truncateInline(text);
}

function summarizeUnknown(value: unknown): string {
  try {
    return truncateInline(JSON.stringify(value));
  } catch {
    return truncateInline(String(value));
  }
}

function truncateInline(value: string): string {
  const inline = value.replaceAll(/\s+/gu, " ").trim();
  return inline.length <= MAX_INLINE_DETAIL_CHARACTERS
    ? inline
    : `${inline.slice(0, MAX_INLINE_DETAIL_CHARACTERS)}…`;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}
