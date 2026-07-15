/*
 * 进度协调器把当前任务契约与 Git 完成账本对齐，生成新 Run 的初始任务投影。
 * 它不执行任务、不写状态，也不理解 Git 命令；所有历史事实通过 Workspace 端口读取。
 */
import { ConfigurationError } from "../domain/errors.js";
import type { LoadedTaskManifest, TaskDefinition } from "../domain/manifest.js";
import type { InitialTaskRunState } from "../domain/run-state.js";
import { createDependencyCompletionFingerprint } from "../domain/task-completion.js";
import type {
  TaskCompletionEvidence,
  Workspace,
} from "../ports/workspace.js";

export type TaskReuseReason =
  | "reused"
  | "fresh_run"
  | "never_completed"
  | "contract_changed"
  | "dependency_changed";

export interface TaskReuseDecision {
  readonly taskId: string;
  readonly reason: TaskReuseReason;
  readonly commitSha?: string | undefined;
  readonly evidenceRunId?: string | undefined;
}

export interface TaskProgressPlan {
  readonly tasks: readonly InitialTaskRunState[];
  readonly decisions: readonly TaskReuseDecision[];
}

export class TaskProgressReconciler {
  public constructor(private readonly workspace: Workspace) {}

  /*
   * fresh 明确绕过历史读取；默认模式只复用契约、依赖指纹均匹配且位于当前 HEAD 祖先链的提交。
   * 任务按拓扑顺序决策，因此上游没有复用时，下游即使存在旧提交也会被标记为依赖失效。
   */
  public async createPlan(input: {
    loaded: LoadedTaskManifest;
    orderedTasks: readonly TaskDefinition[];
    head: string;
    fresh: boolean;
  }): Promise<TaskProgressPlan> {
    if (input.fresh) {
      return {
        tasks: input.orderedTasks.map((task) => ({ taskId: task.id })),
        decisions: input.orderedTasks.map((task) => ({
          taskId: task.id,
          reason: "fresh_run",
        })),
      };
    }

    const history = await this.workspace.readTaskCompletionHistory(input.head);
    /*
     * Git 历史按新到旧返回；首次出现即为该 TASK 的最新完成事实。
     * 预先建立索引让核验复杂度保持 O(提交数 + 任务数)，不会随大型任务目录退化为重复扫描。
     */
    const latestCompletionByTask = new Map<string, TaskCompletionEvidence>();
    for (const evidence of history) {
      if (!latestCompletionByTask.has(evidence.taskId)) {
        latestCompletionByTask.set(evidence.taskId, evidence);
      }
    }
    const reused = new Map<string, TaskCompletionEvidence>();
    const tasks: InitialTaskRunState[] = [];
    const decisions: TaskReuseDecision[] = [];

    for (const task of input.orderedTasks) {
      const contractHash = input.loaded.taskContractHashes.get(task.id);
      if (contractHash === undefined) {
        throw new ConfigurationError(`任务缺少完成契约指纹：${task.id}`);
      }
      const dependencies = task.dependsOn.map((taskId) => ({
        taskId,
        evidence: reused.get(taskId),
      }));
      if (dependencies.some((dependency) => dependency.evidence === undefined)) {
        tasks.push({ taskId: task.id });
        decisions.push({ taskId: task.id, reason: "dependency_changed" });
        continue;
      }
      const dependencyFingerprint = createDependencyCompletionFingerprint(
        dependencies.map((dependency) => ({
          taskId: dependency.taskId,
          commitSha: requireDependencyEvidence(dependency).commitSha,
        })),
      );
      const latest = latestCompletionByTask.get(task.id);
      if (
        latest === undefined
        || latest.taskContractHash !== contractHash
        || latest.dependencyFingerprint !== dependencyFingerprint
      ) {
        tasks.push({ taskId: task.id });
        decisions.push({
          taskId: task.id,
          reason: latest === undefined
            ? "never_completed"
            : latest.taskContractHash !== contractHash
              ? "contract_changed"
              : "dependency_changed",
        });
        continue;
      }

      reused.set(task.id, latest);
      tasks.push({
        taskId: task.id,
        reusedCompletion: {
          commitSha: latest.commitSha,
          evidenceRunId: latest.runId,
          contractHash,
          dependencyFingerprint,
        },
      });
      decisions.push({
        taskId: task.id,
        reason: "reused",
        commitSha: latest.commitSha,
        evidenceRunId: latest.runId,
      });
    }

    return { tasks, decisions };
  }
}

/*
 * 调用方已经在生成依赖指纹前完成整组存在性检查；此守卫把该不变量显式带入类型系统。
 * 若未来循环结构变化破坏检查顺序，这里会立即失败，而不是写入带空字符串的魔法指纹。
 */
function requireDependencyEvidence(input: {
  readonly taskId: string;
  readonly evidence: TaskCompletionEvidence | undefined;
}): TaskCompletionEvidence {
  if (input.evidence === undefined) {
    throw new ConfigurationError(`依赖缺少完成证据：${input.taskId}`);
  }
  return input.evidence;
}
