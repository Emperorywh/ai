/*
 * 单 TASK 阶段通过稳定输入与结果契约协作，阶段实现不持有队列游标或持久化后端。
 * QueueOrchestrator 仍是 checkpoint 唯一协调者，各阶段只能通过回调提交显式状态事实。
 */
import type { LoadedProject, TaskDefinition } from "../domain/project.js";
import type { RunState } from "../domain/run-state.js";

/*
 * 阶段内 checkpoint 回调属于任务执行契约，不归属于任何具体会话控制器。
 * Worker 与 Reviewer 都依赖该稳定类型，避免一方的实现模块成为另一方的类型入口。
 */
export type TaskCheckpointWriter = (
  state: RunState,
  message: string,
  details?: Readonly<Record<string, unknown>>,
) => Promise<void>;

export interface TaskStepResult {
  readonly state: RunState;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface TaskStepInput {
  readonly loaded: LoadedProject;
  readonly state: RunState;
  readonly task: TaskDefinition;
  readonly resumeExistingExecution: boolean;
  readonly signal?: AbortSignal;
  readonly onCheckpoint?: TaskCheckpointWriter;
}
