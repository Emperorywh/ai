/*
 * 组合根是具体基础设施的唯一装配位置，CLI 命令不会自行创建 Agent、Git 或持久化实现。
 * 这种边界让应用层保持可测试，也让未来替换模型供应商或状态后端时不影响编排状态机。
 */
import { resolve } from "node:path";
import type { LoadedProject } from "../domain/project.js";
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
import { SystemClock } from "../infrastructure/system-clock.js";
import { FileProjectRepository } from "../infrastructure/tasks/file-project-repository.js";
import { BeijingTimeFormatter } from "../infrastructure/time/beijing-time-formatter.js";
import type { TimeFormatter } from "../ports/time-formatter.js";

export interface OrchestratorRuntime {
  readonly loaded: LoadedProject;
  readonly orchestrator: QueueOrchestrator;
  readonly stateDirectory: string;
  readonly timeFormatter: TimeFormatter;
}

export async function loadProject(
  projectRoot: string,
): Promise<LoadedProject> {
  return new FileProjectRepository().load(resolve(projectRoot));
}

export async function createOrchestratorRuntime(
  projectRoot: string,
): Promise<OrchestratorRuntime> {
  const loaded = await loadProject(projectRoot);
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
