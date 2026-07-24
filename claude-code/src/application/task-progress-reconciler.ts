/*
 * 进度协调器把当前任务契约与 Git 完成账本对齐，生成新 Run 的初始任务投影。
 * 它不执行任务、不写状态，也不理解 Git 命令；所有历史事实通过 Workspace 端口读取。
 */
import { ConfigurationError } from "../domain/errors.js";
import type { LoadedProject } from "../domain/project.js";
import type { InitialTaskRunState } from "../domain/run-state.js";
import { createPredecessorCompletionFingerprint } from "../domain/task-completion.js";
import type { CanonicalHashService } from "../ports/canonical-hash.js";
import type {
  TaskCompletionEvidence,
  TaskCompletionLedger,
} from "../ports/workspace.js";

export type TaskReuseReason =
  | "reused"
  | "fresh_run"
  | "never_completed"
  | "contract_changed"
  | "predecessor_changed";

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
  public constructor(
    private readonly workspace: TaskCompletionLedger,
    private readonly canonicalHash: CanonicalHashService,
  ) {}

  /*
   * fresh 明确绕过历史读取；默认模式只复用契约、前驱指纹均匹配且位于当前 HEAD 祖先链的提交。
   * 复用必须形成从根任务开始的连续前缀，任一节点失效后不再探测后续节点的历史证据。
   */
  public async createPlan(input: {
    loaded: LoadedProject;
    head: string;
    fresh: boolean;
  }): Promise<TaskProgressPlan> {
    if (input.fresh) {
      return {
        tasks: input.loaded.tasks.map((task) => ({ taskId: task.id })),
        decisions: input.loaded.tasks.map((task) => ({
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
    const tasks: InitialTaskRunState[] = [];
    const decisions: TaskReuseDecision[] = [];
    let reusablePrefix = true;
    let predecessor: TaskCompletionEvidence | undefined;

    for (const task of input.loaded.tasks) {
      const contractHash = input.loaded.taskContractHashes.get(task.id);
      if (contractHash === undefined) {
        throw new ConfigurationError(`任务缺少完成契约指纹：${task.id}`);
      }

      /*
       * 前缀一旦断裂，后续任务即使局部契约未变也必须重新执行。
       * 这里不读取后续旧证据，避免出现中间缺口却复用尾部任务的非线性状态。
       */
      if (!reusablePrefix) {
        tasks.push({ taskId: task.id });
        decisions.push({ taskId: task.id, reason: "predecessor_changed" });
        continue;
      }
      const predecessorFingerprint = createPredecessorCompletionFingerprint(
        predecessor === undefined
          ? undefined
          : { taskId: predecessor.taskId, commitSha: predecessor.commitSha },
        this.canonicalHash,
      );
      const latest = latestCompletionByTask.get(task.id);
      if (
        latest === undefined
        || latest.taskContractHash !== contractHash
        || latest.predecessorFingerprint !== predecessorFingerprint
      ) {
        reusablePrefix = false;
        tasks.push({ taskId: task.id });
        decisions.push({
          taskId: task.id,
          reason: latest === undefined
            ? "never_completed"
            : latest.taskContractHash !== contractHash
              ? "contract_changed"
              : "predecessor_changed",
        });
        continue;
      }

      predecessor = latest;
      tasks.push({
        taskId: task.id,
        reusedCompletion: {
          commitSha: latest.commitSha,
          evidenceRunId: latest.runId,
          contractHash,
          predecessorFingerprint,
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
