/*
 * 门禁进程测试使用项目自身的包管理器命令验证真实系统进程边界。
 * 该用例不会启动浏览器或开发服务，只确认 Windows 的 pnpm.cmd shim 能被安全解析并执行。
 */
import { describe, expect, it } from "vitest";
import { NodeGateRunner } from "../src/infrastructure/process/node-gate-runner.js";

describe("NodeGateRunner", () => {
  it("跨平台执行 PATH 中的 pnpm 命令 shim", async () => {
    const runner = new NodeGateRunner();
    /*
     * command 与 args 保持分离，回归覆盖不能使用原生 spawn 解析 pnpm.cmd 的 Windows 场景。
     * 版本查询是只读且快速的门禁，适合作为真实子进程探针。
     */
    const results = await runner.run(process.cwd(), [{
      name: "pnpm-version",
      command: "pnpm",
      args: ["--version"],
      timeoutMinutes: 1,
    }]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: "pnpm-version",
      command: "pnpm",
      args: ["--version"],
      exitCode: 0,
      timedOut: false,
      stderr: "",
    });
    expect(results[0]?.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/u);
  });
});
