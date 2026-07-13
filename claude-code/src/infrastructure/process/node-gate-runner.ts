/*
 * 门禁进程通过 command + args 直接启动，不经过 shell，因此配置不会被二次解释或串联执行。
 * 多个门禁严格按声明顺序运行，首个失败即停止，输出保留尾部以控制状态文件体积。
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { GateDefinition } from "../../domain/manifest.js";
import type { GateExecutionState } from "../../domain/run-state.js";
import type { GateRunner } from "../../ports/gate-runner.js";

const MAX_CAPTURED_CHARACTERS = 1_000_000;
const FORCE_KILL_GRACE_MS = 2_000;

export class NodeGateRunner implements GateRunner {
  public async run(
    cwd: string,
    gates: readonly GateDefinition[],
    signal?: AbortSignal,
  ): Promise<readonly GateExecutionState[]> {
    const results: GateExecutionState[] = [];

    for (const gate of gates) {
      if (signal?.aborted === true) {
        break;
      }

      const result = await this.runOne(cwd, gate, signal);
      results.push(result);
      if (result.exitCode !== 0 || result.timedOut) {
        break;
      }
    }

    return results;
  }

  private runOne(
    cwd: string,
    gate: GateDefinition,
    signal?: AbortSignal,
  ): Promise<GateExecutionState> {
    return new Promise((resolveResult) => {
      const startedAt = Date.now();
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let stopping = false;
      let forceKillTimer: NodeJS.Timeout | undefined;

      const child = spawn(gate.command, gate.args, {
        cwd,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });

      const appendOutput = (current: string, chunk: Buffer): string => {
        const next = current + chunk.toString("utf8");
        return next.length <= MAX_CAPTURED_CHARACTERS
          ? next
          : next.slice(-MAX_CAPTURED_CHARACTERS);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendOutput(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendOutput(stderr, chunk);
      });

      const finish = (exitCode: number | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (forceKillTimer !== undefined) {
          clearTimeout(forceKillTimer);
        }
        signal?.removeEventListener("abort", abortHandler);
        resolveResult({
          name: gate.name,
          command: gate.command,
          args: gate.args,
          exitCode,
          timedOut,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
        });
      };

      const stopChild = (): void => {
        if (stopping) {
          return;
        }
        stopping = true;
        terminateProcessTree(child, false);
        forceKillTimer = setTimeout(
          () => terminateProcessTree(child, true),
          FORCE_KILL_GRACE_MS,
        );
      };
      const abortHandler = (): void => {
        stderr = appendOutput(stderr, Buffer.from("\n门禁被外部中止。\n"));
        stopChild();
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        stderr = appendOutput(
          stderr,
          Buffer.from(`\n门禁超过 ${gate.timeoutMinutes} 分钟，已终止。\n`),
        );
        stopChild();
      }, gate.timeoutMinutes * 60_000);

      signal?.addEventListener("abort", abortHandler, { once: true });
      if (signal?.aborted === true) {
        abortHandler();
      }
      child.once("error", (error) => {
        stderr = appendOutput(stderr, Buffer.from(`\n${error.message}\n`));
        finish(null);
      });
      child.once("close", (code) => {
        finish(code);
      });
    });
  }
}

function terminateProcessTree(child: ChildProcess, force: boolean): void {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill",
      ["/pid", String(child.pid), "/t", ...(force ? ["/f"] : [])],
      { windowsHide: true, stdio: "ignore" },
    );
    killer.once("error", () => undefined);
    return;
  }

  try {
    process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  }
}
