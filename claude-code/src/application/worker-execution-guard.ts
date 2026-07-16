/*
 * WorkerExecutionGuard 集中声明不可逆或超出编排职责的工具行为。
 * Worker 仍可修改整个项目并运行普通命令；守卫只拒绝 Git 历史、远端发布、部署、浏览器和常驻服务。
 */
import type {
  ExecutionGuard,
  ExecutionGuardDecision,
} from "../ports/execution-guard.js";

const BLOCKED_TOOL_NAME = /(?:browser|playwright|puppeteer|deploy|publish)/iu;
const BLOCKED_MUTATING_MCP_TOOL = /^mcp__.*(?:create|delete|deploy|edit|merge|post|publish|push|send|update|upload)/iu;
const BLOCKED_COMMANDS: readonly RegExp[] = [
  /\bgit(?:\s+(?:(?:-C|-c|--git-dir|--work-tree)(?:\s+|=)?\S+|--\S+))*\s+(?:am|branch|checkout|cherry-pick|clean|clone|commit|commit-tree|fetch|merge|mktag|notes|pack-refs|pull|push|rebase|replace|reset|restore|revert|stash|switch|symbolic-ref|tag|update-index|update-ref|worktree)\b/iu,
  /\b(?:npm|pnpm|yarn)\s+(?:publish|(?:run\s+)?(?:dev|preview|serve|start))\b/iu,
  /\b(?:vite|webpack-dev-server|next\s+dev|react-scripts\s+start)\b/iu,
  /\b(?:playwright|puppeteer|selenium|cypress)\b/iu,
  /\bgh\s+(?:pr|release|repo)\s+(?:create|delete|edit|merge|publish)\b/iu,
  /\b(?:vercel|netlify|firebase)\s+(?:deploy|publish)\b/iu,
  /\b(?:docker\s+push|kubectl\s+(?:apply|create|delete)|helm\s+(?:install|upgrade|uninstall))\b/iu,
  /\b(?:terraform|tofu)\s+(?:apply|destroy|import)\b/iu,
  /\bcurl\b[^\r\n]*(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)\b/iu,
  /\b(?:aws|az|gcloud)\s+\S+\s+(?:create|delete|deploy|publish|put|send|update|upload)\b/iu,
];

export class WorkerExecutionGuard implements ExecutionGuard {
  public inspect(toolName: string, input: unknown): ExecutionGuardDecision {
    if (
      BLOCKED_TOOL_NAME.test(toolName)
      || BLOCKED_MUTATING_MCP_TOOL.test(toolName)
    ) {
      return {
        allowed: false,
        reason: `系统策略禁止 Worker 调用 ${toolName} 工具`,
      };
    }
    if (toolName !== "Bash") {
      return { allowed: true };
    }

    const command = readCommand(input);
    if (command === undefined) {
      return { allowed: true };
    }
    const blocked = BLOCKED_COMMANDS.find((pattern) => pattern.test(command));
    return blocked === undefined
      ? { allowed: true }
      : {
          allowed: false,
          reason: "系统策略禁止 Git 历史操作、发布部署、浏览器或常驻服务命令",
        };
  }
}

function readCommand(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }
  const command = (input as Readonly<Record<string, unknown>>)["command"];
  return typeof command === "string" ? command : undefined;
}
