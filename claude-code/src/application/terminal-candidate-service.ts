/*
 * TerminalCandidateService 是 blocked/failed TASK 候选离开主工作区的唯一应用入口。
 * 它只处理线性队首终态并立即 checkpoint，归档算法与 Git 引用细节仍封装在端口后方。
 */
import type { TaskDefinition } from "../domain/project.js";
import { replaceTaskFields, type RunState } from "../domain/run-state.js";
import type { Clock } from "../ports/clock.js";
import type { CandidateQuarantine } from "../ports/workspace.js";
import type { RunCheckpointWriter } from "./run-checkpoint-writer.js";

export class TerminalCandidateService {
  public constructor(
    private readonly quarantine: CandidateQuarantine,
    private readonly checkpoints: RunCheckpointWriter,
    private readonly clock: Clock,
  ) {}

  public async archiveIfNecessary(
    state: RunState,
    orderedTasks: readonly TaskDefinition[],
  ): Promise<RunState | undefined> {
    const task = orderedTasks.find(
      (candidate) => state.tasks[candidate.id]?.status !== "completed",
    );
    const taskState = task === undefined ? undefined : state.tasks[task.id];
    if (
      task === undefined
      || (taskState?.status !== "blocked" && taskState?.status !== "failed")
      || taskState.candidateArchive !== undefined
    ) {
      return undefined;
    }

    const archive = await this.quarantine.quarantineCandidate({
      runId: state.runId,
      taskId: task.id,
    });
    const nextState = replaceTaskFields(
      state,
      task.id,
      {
        candidateArchive: {
          ...(archive.reference === undefined ? {} : { reference: archive.reference }),
          changedFiles: archive.changedFiles,
          archivedAt: this.now(),
        },
      },
      this.now(),
    );
    await this.checkpoints.write({
      state: nextState,
      orderedTasks,
      taskId: task.id,
      type: "task_candidate_quarantined",
      message: archive.reference === undefined
        ? "终态任务没有未提交候选，工作区保持干净"
        : `终态任务候选已隔离到 ${archive.reference}`,
      details: { changedFiles: archive.changedFiles },
    });
    return nextState;
  }

  private now(): string {
    return this.clock.now().toISOString();
  }
}
