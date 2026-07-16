/*
 * 组合根是具体基础设施的唯一装配位置，CLI 命令不会自行创建 Agent、Git 或持久化实现。
 * 这种边界让应用层保持可测试，也让未来替换模型供应商或状态后端时不影响编排状态机。
 */
import { resolve } from "node:path";
import type { LoadedProject } from "../domain/project.js";
import { PromptBuilder } from "../application/prompt-builder.js";
import { QueueOrchestrator } from "../application/queue-orchestrator.js";
import { RunArtifactWriter } from "../application/run-artifact-writer.js";
import { RunCheckpointWriter } from "../application/run-checkpoint-writer.js";
import { RunFinalizer } from "../application/run-finalizer.js";
import { RunResumeValidator } from "../application/run-resume-validator.js";
import { CommitStage } from "../application/commit-stage.js";
import { ImplementationStage } from "../application/implementation-stage.js";
import { ReviewStage } from "../application/review-stage.js";
import { TaskExecutionService } from "../application/task-execution-service.js";
import { TaskStageSupport } from "../application/task-stage-support.js";
import { TerminalCandidateService } from "../application/terminal-candidate-service.js";
import { TaskProgressReconciler } from "../application/task-progress-reconciler.js";
import { TaskResourceBudget } from "../application/task-resource-budget.js";
import { WorkerExecutionGuard } from "../application/worker-execution-guard.js";
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
import { FileProjectContextProvider } from "../infrastructure/tasks/file-project-context-provider.js";
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
  const agent = new ClaudeAgentSdkExecutor({
    messageObserver: new ConsoleClaudeMessageObserver({
      timestamp: () => timeFormatter.formatTimestamp(clock.now()),
    }),
    executionGuard: new WorkerExecutionGuard(),
  });
  const promptBuilder = new PromptBuilder();
  const resourceBudget = new TaskResourceBudget();
  const stageSupport = new TaskStageSupport(clock);
  const projectContext = new FileProjectContextProvider();
  const taskExecution = new TaskExecutionService(
    new ImplementationStage(
      agent,
      workspace,
      promptBuilder,
      projectContext,
      clock,
      resourceBudget,
      stageSupport,
    ),
    new ReviewStage(
      agent,
      workspace,
      promptBuilder,
      projectContext,
      clock,
      resourceBudget,
      stageSupport,
    ),
    new CommitStage(workspace, stageSupport),
  );
  const checkpoints = new RunCheckpointWriter(stateStore, logger, clock);

  return {
    loaded,
    stateDirectory,
    timeFormatter,
    orchestrator: new QueueOrchestrator({
      taskExecution,
      taskProgress: new TaskProgressReconciler(workspace),
      stateStore,
      runLock: new FileRunLock(stateDirectory),
      workspace,
      checkpoints,
      resumeValidator: new RunResumeValidator(workspace),
      finalizer: new RunFinalizer(),
      artifacts: new RunArtifactWriter(stateStore, timeFormatter),
      terminalCandidates: new TerminalCandidateService(
        workspace,
        checkpoints,
        clock,
      ),
      clock,
      timeFormatter,
    }),
  };
}
