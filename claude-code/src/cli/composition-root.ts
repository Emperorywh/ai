/*
 * 组合根是具体基础设施的唯一装配位置，CLI 命令不会自行创建 Agent、Git 或持久化实现。
 * 这种边界让应用层保持可测试，也让未来替换模型供应商或状态后端时不影响编排状态机。
 */
import type { LoadedTaskManifest } from "../domain/manifest.js";
import { PromptBuilder } from "../application/prompt-builder.js";
import { QueueOrchestrator } from "../application/queue-orchestrator.js";
import { TaskExecutionService } from "../application/task-execution-service.js";
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

export interface OrchestratorRuntime {
  readonly loaded: LoadedTaskManifest;
  readonly orchestrator: QueueOrchestrator;
  readonly stateDirectory: string;
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
  const logger = new CompositeEventLogger([
    new ConsoleEventLogger(),
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
    orchestrator: new QueueOrchestrator(
      taskExecution,
      stateStore,
      new FileRunLock(stateDirectory),
      workspace,
      logger,
      clock,
    ),
  };
}
