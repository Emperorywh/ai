#!/usr/bin/env node
/*
 * CLI 入口只解析用户意图、管理中断信号并映射稳定退出码，业务决策全部委托给应用服务。
 * run 与 resume 共用同一驱动器，因此无人值守执行、崩溃恢复和交互执行不会形成两套逻辑。
 */
import { resolve } from "node:path";
import { Command } from "commander";
import type { OrchestratorResult } from "../application/queue-orchestrator.js";
import { presentRunState } from "../application/run-state-presentation.js";
import type { RunState } from "../domain/run-state.js";
import {
  createOrchestratorRuntime,
  loadManifest,
} from "./composition-root.js";
import {
  writeSampleProject,
  type SampleProjectWriteResult,
} from "./sample-project-writer.js";

const DEFAULT_MANIFEST = "orchestrator.yaml";
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_BLOCKED = 2;
const EXIT_INTERRUPTED = 130;

interface ManifestOptions {
  readonly manifest: string;
}

interface RunOptions extends ManifestOptions {
  readonly fresh: boolean;
}

const program = new Command()
  .name("claude-task-orchestrator")
  .description("基于 Claude Agent SDK 的单并发 TASK 队列编排器");

program
  .command("init")
  .description("增量生成最小配置骨架，保留并跳过已有普通文件")
  .argument("[directory]", "目标项目目录", ".")
  .action(async (directory: string) => {
    const result = await writeSampleProject(directory);
    printInitializationResult(result);
  });

program
  .command("validate")
  .description("校验 Manifest、完整 TASK 目录、路径和任务 DAG")
  .option("-m, --manifest <path>", "Manifest 文件", DEFAULT_MANIFEST)
  .action(async (options: ManifestOptions) => {
    const loaded = await loadManifest(resolve(options.manifest));
    process.stdout.write([
      "配置校验通过",
      `项目：${loaded.projectRoot}`,
      `任务数：${loaded.tasks.length}`,
      `任务队列：${loaded.tasks.map((task) => task.id).join(" → ")}`,
      `内容哈希：${loaded.manifestHash}`,
      "",
    ].join("\n"));
  });

program
  .command("run")
  .description("创建新运行，核验并复用有效 TASK 进度")
  .option("-m, --manifest <path>", "Manifest 文件", DEFAULT_MANIFEST)
  .option("--fresh", "明确放弃历史完成证据并全量重跑", false)
  .action(async (options: RunOptions) => {
    const runtime = await createOrchestratorRuntime(resolve(options.manifest));
    /*
     * run 始终创建新的 Run 记录，但默认先做项目级进度核验；只有显式 --fresh 才跳过复用。
     * resume 继续保持同一 Run checkpoint 语义，两条路径不会共享隐式状态。
     */
    await executeRuntime(
      runtime,
      (signal) => runtime.orchestrator.start(runtime.loaded, {
        fresh: options.fresh,
        signal,
      }),
    );
  });

program
  .command("resume")
  .description("从持久化 checkpoint 恢复最近或指定运行")
  .argument("[runId]", "要恢复的运行 ID；省略时使用最近运行")
  .option("-m, --manifest <path>", "Manifest 文件", DEFAULT_MANIFEST)
  .action(async (runId: string | undefined, options: ManifestOptions) => {
    const runtime = await createOrchestratorRuntime(resolve(options.manifest));
    const state = await runtime.orchestrator.getState(runId);
    if (state === undefined) {
      throw new Error("找不到可恢复的运行状态");
    }
    await executeRuntime(
      runtime,
      (signal) => runtime.orchestrator.resume(runtime.loaded, state.runId, signal),
    );
  });

program
  .command("continue")
  .description("无状态时新建、运行中时恢复、终态时安全返回")
  .option("-m, --manifest <path>", "Manifest 文件", DEFAULT_MANIFEST)
  .action(async (options: ManifestOptions) => {
    const runtime = await createOrchestratorRuntime(resolve(options.manifest));
    const state = await runtime.orchestrator.getState();
    if (state !== undefined && state.status !== "running") {
      await executeRuntime(
        runtime,
        (signal) => runtime.orchestrator.resume(runtime.loaded, state.runId, signal),
      );
      return;
    }
    await executeRuntime(
      runtime,
      state === undefined
        ? (signal) => runtime.orchestrator.start(runtime.loaded, { signal })
        : (signal) => runtime.orchestrator.resume(
            runtime.loaded,
            state.runId,
            signal,
          ),
    );
  });

program
  .command("status")
  .description("读取最近或指定运行的持久化状态")
  .argument("[runId]", "运行 ID；省略时使用最近运行")
  .option("-m, --manifest <path>", "Manifest 文件", DEFAULT_MANIFEST)
  .action(async (runId: string | undefined, options: ManifestOptions) => {
    const runtime = await createOrchestratorRuntime(resolve(options.manifest));
    const state = await runtime.orchestrator.getState(runId);
    if (state === undefined) {
      throw new Error("尚无运行状态");
    }
    /*
     * status 是面向操作者的只读投影，全部时间转为北京时间后再序列化。
     * 持久化 state.json 不参与转换，恢复逻辑仍消费原始 UTC checkpoint。
     */
    const displayState = presentRunState(state, runtime.timeFormatter);
    process.stdout.write(`${JSON.stringify(displayState, null, 2)}\n`);
  });

await program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`错误：${message}\n`);
  process.exitCode = EXIT_FAILURE;
});

type Runtime = Awaited<ReturnType<typeof createOrchestratorRuntime>>;

/*
 * 初始化输出区分本次创建与已有文件，重复执行不会把“无新文件”误报为失败。
 * 跳过列表显式提醒用户现有内容没有被校验或覆盖，需要自行确认其配置是否仍然适用。
 */
function printInitializationResult(result: SampleProjectWriteResult): void {
  const lines = [
    `初始化完成：创建 ${result.createdFiles.length} 个文件，跳过 ${result.skippedFiles.length} 个已有文件。`,
    ...(result.createdFiles.length === 0
      ? []
      : ["已创建：", ...result.createdFiles]),
    ...(result.skippedFiles.length === 0
      ? []
      : ["已跳过（保留原内容）：", ...result.skippedFiles]),
    "",
  ];
  process.stdout.write(lines.join("\n"));
}

async function executeRuntime(
  runtime: Runtime,
  operation: (signal: AbortSignal) => Promise<OrchestratorResult>,
): Promise<void> {
  const controller = installGracefulInterrupt();
  const result = await operation(controller.signal);
  printResult(result, runtime.stateDirectory);
  process.exitCode = exitCodeFor(result.state, controller.signal.aborted);
}

function installGracefulInterrupt(): AbortController {
  const controller = new AbortController();
  let interruptCount = 0;
  const interrupt = (signal: "SIGINT" | "SIGTERM"): void => {
    interruptCount += 1;
    if (interruptCount === 1) {
      process.stderr.write(
        `\n收到 ${signal}，正在停止当前阶段并保存 checkpoint……\n`,
      );
      controller.abort();
      return;
    }
    process.stderr.write("\n再次收到中断信号，立即退出；当前阶段可能需要 resume 恢复。\n");
    process.exit(EXIT_INTERRUPTED);
  };
  process.on("SIGINT", () => interrupt("SIGINT"));
  process.on("SIGTERM", () => interrupt("SIGTERM"));
  return controller;
}

function printResult(result: OrchestratorResult, stateDirectory: string): void {
  process.stdout.write([
    "",
    `运行 ID：${result.state.runId}`,
    `最终状态：${result.state.status}`,
    `状态目录：${stateDirectory}`,
    ...(result.artifacts.length === 0
      ? []
      : ["验收产物：", ...result.artifacts]),
    "",
  ].join("\n"));
}

function exitCodeFor(state: RunState, interrupted: boolean): number {
  if (interrupted && state.status === "running") {
    return EXIT_INTERRUPTED;
  }
  if (state.status === "completed") {
    return EXIT_SUCCESS;
  }
  return state.status === "blocked" ? EXIT_BLOCKED : EXIT_FAILURE;
}
