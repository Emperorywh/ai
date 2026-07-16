/*
 * RunCheckpointWriter 是运行状态持久化与事件日志的唯一事务边界。
 * 每次保存前先验证完整语义不变量，任何调用方都不能绕过校验写入不可恢复快照。
 */
import type { TaskDefinition } from "../domain/project.js";
import { StateTransitionError } from "../domain/errors.js";
import { assertRunStateInvariants } from "../domain/run-state-invariants.js";
import { runStateSchema, type RunState } from "../domain/run-state.js";
import type { Clock } from "../ports/clock.js";
import type { EventLogger } from "../ports/event-logger.js";
import type { StateStore } from "../ports/state-store.js";

export interface RunCheckpoint {
  readonly state: RunState;
  readonly orderedTasks: readonly TaskDefinition[];
  readonly taskId?: string | undefined;
  readonly type: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export class RunCheckpointWriter {
  public constructor(
    private readonly stateStore: StateStore,
    private readonly logger: EventLogger,
    private readonly clock: Clock,
  ) {}

  public async write(checkpoint: RunCheckpoint): Promise<void> {
    const parsed = runStateSchema.safeParse(checkpoint.state);
    if (!parsed.success) {
      throw new StateTransitionError(
        `拒绝写入字段契约无效的运行状态：${parsed.error.issues
          .map((issue) => issue.message)
          .join("；")}`,
      );
    }
    assertRunStateInvariants(parsed.data, checkpoint.orderedTasks);
    await this.stateStore.save(parsed.data);
    await this.logger.log({
      timestamp: this.clock.now().toISOString(),
      runId: parsed.data.runId,
      ...(checkpoint.taskId === undefined ? {} : { taskId: checkpoint.taskId }),
      type: checkpoint.type,
      message: checkpoint.message,
      ...(checkpoint.details === undefined ? {} : { details: checkpoint.details }),
    });
  }
}
