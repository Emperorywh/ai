/*
 * 终端观察器测试使用内存 writer 验证增量文本、工具动态、系统状态和 stderr 的实时投影。
 * 用例只构造 SDK 消息对象，不启动 Claude Code 子进程，也不依赖真实终端能力。
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { ConsoleClaudeMessageObserver } from "../src/infrastructure/claude/console-claude-message-observer.js";
import type { ClaudeMessageContext } from "../src/infrastructure/claude/claude-message-observer.js";

const context: ClaudeMessageContext = {
  taskId: "TASK-001",
  attemptKind: "implementation",
};

describe("ConsoleClaudeMessageObserver", () => {
  it("连续展示 Claude 文本、工具执行、状态与错误输出", () => {
    let stdout = "";
    let stderr = "";
    const observer = new ConsoleClaudeMessageObserver(
      (content) => {
        stdout += content;
      },
      (content) => {
        stderr += content;
      },
    );

    observer.onMessage(context, createTextDelta("正在分析项目"));
    observer.onMessage(context, createAssistantToolUse());
    observer.onMessage(context, createToolProgress());
    observer.onMessage(context, createToolResult());
    /*
     * SDK 会连续发送累计推理 token 事件；观察器应把它们折叠为一次开始提示，
     * 不再把每次估算变化打印到终端。
     */
    observer.onMessage(context, createThinkingTokens());
    observer.onMessage(context, createThinkingTokens(1300));
    observer.onMessage(context, createSuccessResult());
    observer.onStderr(context, "diagnostic line\nsecond line\n");

    expect(stdout).toContain("[TASK-001/implementation] Claude：正在分析项目\n");
    expect(stdout).toContain("调用工具 Read：file_path=src/index.ts");
    expect(stdout).toContain("工具 Read 已运行 2.5 秒");
    expect(stdout).toContain("工具 Read 完成：读取完成");
    expect(stdout.match(/Claude 开始推理/gu)).toHaveLength(1);
    expect(stdout).not.toContain("thinking_tokens");
    expect(stdout).not.toContain("1200 tokens");
    expect(stdout).toContain("Claude 会话成功（3 轮，$0.2500）");
    expect(stderr).toContain("Claude stderr：diagnostic line");
    expect(stderr).toContain("Claude stderr：second line");
  });
});

function createTextDelta(text: string): SDKMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text },
    },
  } as SDKMessage;
}

function createAssistantToolUse(): SDKMessage {
  return {
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        id: "tool-1",
        name: "Read",
        input: { file_path: "src/index.ts" },
      }],
    },
  } as SDKMessage;
}

function createToolProgress(): SDKMessage {
  return {
    type: "tool_progress",
    tool_use_id: "tool-1",
    tool_name: "Read",
    parent_tool_use_id: null,
    elapsed_time_seconds: 2.5,
  } as SDKMessage;
}

function createToolResult(): SDKMessage {
  return {
    type: "user",
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "tool-1",
        content: "读取完成",
      }],
    },
  } as SDKMessage;
}

function createThinkingTokens(estimatedTokens = 1200): SDKMessage {
  return {
    type: "system",
    subtype: "thinking_tokens",
    estimated_tokens: estimatedTokens,
    estimated_tokens_delta: 100,
  } as SDKMessage;
}

function createSuccessResult(): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    num_turns: 3,
    total_cost_usd: 0.25,
  } as SDKMessage;
}
