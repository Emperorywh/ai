/*
 * Worker 守卫测试覆盖不可逆命令的常见参数变体与允许的本地验证命令。
 * 这些用例验证系统 Hook 的确定性策略，不启动 shell、浏览器或任何外部进程。
 */
import { describe, expect, it } from "vitest";
import { WorkerExecutionGuard } from "../src/application/worker-execution-guard.js";

describe("WorkerExecutionGuard", () => {
  const guard = new WorkerExecutionGuard();

  it.each([
    "git commit -m test",
    "git -C ../repo reset --hard",
    "git -C../repo commit -m test",
    "git update-ref refs/heads/main deadbeef",
    "git fetch origin",
    "sudo git checkout main",
    "cd app && git restore .",
    "pnpm run dev",
    "npm start",
    "npx playwright test",
    "vercel deploy",
    "kubectl apply -f deployment.yaml",
    "gh pr merge 123",
    "terraform apply -auto-approve",
    "curl -X POST https://example.com/api",
  ])("拒绝超出 Worker 边界的 Bash 命令：%s", (command) => {
    expect(guard.inspect("Bash", { command })).toMatchObject({
      allowed: false,
    });
  });

  it.each([
    "git status --short",
    "git diff -- src/index.ts",
    "pnpm typecheck",
    "pnpm test",
    "pnpm build",
  ])("允许只读 Git 与非交互验证命令：%s", (command) => {
    expect(guard.inspect("Bash", { command })).toEqual({ allowed: true });
  });

  it("按工具名称拒绝浏览器与发布能力", () => {
    expect(guard.inspect("mcp__browser__navigate", {})).toMatchObject({
      allowed: false,
    });
    expect(guard.inspect("DeployPreview", {})).toMatchObject({
      allowed: false,
    });
    expect(guard.inspect("mcp__slack__send_message", {})).toMatchObject({
      allowed: false,
    });
    expect(guard.inspect("mcp__docs__search", {})).toEqual({ allowed: true });
  });
});
