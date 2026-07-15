/*
 * 组合根是具体基础设施的唯一装配位置，CLI 命令不会自行创建 Agent、Git 或持久化实现。
 * 这种边界让应用层保持可测试，也让未来替换模型供应商或状态后端时不影响编排状态机。
 */
import type { LoadedTaskManifest } from "../domain/manifest.js";
import { PromptBuilder } from "../application/prompt-builder.js";
import { QueueOrchestrator } from "../application/queue-orchestrator.js";
import { TaskExecutionService } from "../application/task-execution-service.js";
import { TaskProgressReconciler } from "../application/task-progress-reconciler.js";
import { ClaudeAgentSdkExecutor } from "../infrastructure/claude/claude-agent-sdk-executor.js";
import { ConsoleClaudeMessageObserver } from "../infrastructure/claude/console-claude-message-observer.js";
import { GitWorkspace } from "../infrastructure/git/git-workspace.js";
import {
  CompositeEventLogger,
  ConsoleEventLogger,
  JsonlEventLogger,
} from "../infrastructure/logging/event-loggers.js";
import { FileRunLock } from "../infrastructure/persistence/file-run-lock.js";
import { FileStateStore } from "../infrastructure/persistence/file-state-store.js";
import { NodeGateRunner } from "../infrastructure/process/node-gate-runner.js";
import { SystemClock } from "../infrastructure/system-clock.js";
import { YamlManifestRepository } from "../infrastructure/tasks/yaml-manifest-repository.js";
import { BeijingTimeFormatter } from "../infrastructure/time/beijing-time-formatter.js";
import type { TimeFormatter } from "../ports/time-formatter.js";

export interface OrchestratorRuntime {
  readonly loaded: LoadedTaskManifest;
  readonly orchestrator: QueueOrchestrator;
  readonly stateDirectory: string;
  readonly timeFormatter: TimeFormatter;
}

export async function loadManifest(
  manifestPath: string,
): Promise<LoadedTaskManifest> {
  return new YamlManifestRepository().load(manifestPath);
}

export async function createOrchestratorRuntime(
  manifestPath: string,
): Promise<OrchestratorRuntime> {
  const loaded = await loadManifest(manifestPath);
  const workspace = new GitWorkspace(loaded.projectRoot);
  const stateDirectory = await workspace.getStateDirectory();
  const stateStore = new FileStateStore(stateDirectory);
  const clock = new SystemClock();
  const timeFormatter = new BeijingTimeFormatter();
  const logger = new CompositeEventLogger([
    new ConsoleEventLogger(timeFormatter),
    new JsonlEventLogger(stateDirectory),
  ]);
  const taskExecution = new TaskExecutionService(
    new ClaudeAgentSdkExecutor({
      messageObserver: new ConsoleClaudeMessageObserver(),
    }),
    new NodeGateRunner(),
    workspace,
    new PromptBuilder(),
    clock,
  );

  return {
    loaded,
    stateDirectory,
    timeFormatter,
    orchestrator: new QueueOrchestrator(
      taskExecution,
      new TaskProgressReconciler(workspace),
      stateStore,
      new FileRunLock(stateDirectory),
      workspace,
      logger,
      clock,
      timeFormatter,
    ),
  };
}
