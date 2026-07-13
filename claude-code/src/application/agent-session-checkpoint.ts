/*
 * AgentSessionCheckpoint 显式拥有单次 SDK 调用期间的会话初始化状态，并负责把 init 事件原子落盘。
 * Task 阶段不再通过闭包隐式修改 RunState；调用结束后只能从该控制器读取唯一的最新快照。
 */
import { ConfigurationError } from "../domain/errors.js";
import {
  replaceCurrentAttempt,
  type RunState,
  type TaskAttemptState,
} from "../domain/run-state.js";
import type { Clock } from "../ports/clock.js";

export type TaskCheckpointWriter = (
  state: RunState,
  message: string,
  details?: Readonly<Record<string, unknown>>,
) => Promise<void>;

export class AgentSessionCheckpoint {
  private state: RunState;

  public constructor(
    initialState: RunState,
    private readonly taskId: string,
    private readonly attempt: TaskAttemptState,
    private readonly clock: Clock,
    private readonly writer?: TaskCheckpointWriter,
  ) {
    this.state = initialState;
  }

  public get currentState(): RunState {
    return this.state;
  }

  public async initialize(sessionId: string): Promise<void> {
    if (sessionId !== this.attempt.sessionId) {
      throw new ConfigurationError(
        `Agent 初始化 sessionId 与预期不一致：${sessionId}`,
      );
    }
    const currentAttempt = this.state.tasks[this.taskId]?.attempts.at(-1);
    if (currentAttempt?.sessionInitialized === true) {
      return;
    }

    const initializedAttempt: TaskAttemptState = {
      ...this.attempt,
      sessionInitialized: true,
    };
    this.state = replaceCurrentAttempt(
      this.state,
      this.taskId,
      initializedAttempt,
      this.clock.now().toISOString(),
    );
    await this.writer?.(
      this.state,
      "Agent 会话已初始化",
      { sessionId },
    );
  }
}
