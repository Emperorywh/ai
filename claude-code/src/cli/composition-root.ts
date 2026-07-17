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
import { WorkspaceBaselineResolver } from "../application/workspace-baseline-resolver.js";
import { ClaudeAgentSdkExecutor } from "../infrastructure/claude/claude-agent-sdk-executor.js";
import { SdkClaudeConnectionSettingsResolver } from "../infrastructure/claude/claude-connection-settings-resolver.js";
import { SdkClaudeModelResolver } from "../infrastructure/claude/claude-model-resolver.js";
import { SdkClaudeUserSettingsSource } from "../infrastructure/claude/claude-user-settings-source.js";
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
  const lockDirectory = await workspace.getLockDirectory();
  /*
   * 状态目录保持项目级隔离，锁目录则覆盖共享 HEAD、索引和文件树的整个 Git worktree。
   * 组合根显式装配两种作用域，持久化实现不再猜测 Git 资源所有权。
   */
  const stateStore = new FileStateStore(stateDirectory);
  const clock = new SystemClock();
  const timeFormatter = new BeijingTimeFormatter();
  const logger = new CompositeEventLogger([
    new ConsoleEventLogger(timeFormatter),
    new JsonlEventLogger(stateDirectory),
  ]);
  /*
   * 组合根共享同一个无状态 Claude 设置解析器，并分别注入模型选择端口与连接设置边界。
   * 具体 SDK 类型不会越过基础设施层，应用阶段只依赖可测试的模型字符串契约。
   */
  const claudeUserSettings = new SdkClaudeUserSettingsSource();
  const connectionSettings = new SdkClaudeConnectionSettingsResolver(
    claudeUserSettings,
  );
  const modelResolver = new SdkClaudeModelResolver(claudeUserSettings);
  const agent = new ClaudeAgentSdkExecutor({
    messageObserver: new ConsoleClaudeMessageObserver({
      timestamp: () => timeFormatter.formatTimestamp(clock.now()),
    }),
    executionGuard: new WorkerExecutionGuard(),
    connectionSettingsResolver: connectionSettings,
  });
  const promptBuilder = new PromptBuilder();
  const resourceBudget = new TaskResourceBudget();
  const stageSupport = new TaskStageSupport(clock);
  const baselineResolver = new WorkspaceBaselineResolver(workspace);
  const projectContext = new FileProjectContextProvider();
  const taskExecution = new TaskExecutionService(
    new ImplementationStage(
      agent,
      workspace,
      promptBuilder,
      projectContext,
      modelResolver,
      clock,
      resourceBudget,
      stageSupport,
    ),
    new ReviewStage(
      agent,
      workspace,
      promptBuilder,
      projectContext,
      modelResolver,
      clock,
      resourceBudget,
      stageSupport,
    ),
    new CommitStage(workspace, stageSupport, baselineResolver),
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
      runLock: new FileRunLock(lockDirectory),
      workspace,
      checkpoints,
      resumeValidator: new RunResumeValidator(workspace, baselineResolver),
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
