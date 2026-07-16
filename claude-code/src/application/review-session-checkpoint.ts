/*
 * ReviewSessionCheckpoint 持有单次 Reviewer SDK 调用期间的唯一状态快照。
 * Reviewer init 的实际模型和 session 在继续读取候选前落盘，恢复时不会依赖控制台日志猜测。
 */
import { ConfigurationError } from "../domain/errors.js";
import {
  replaceCurrentReviewAttempt,
  type ReviewAttemptState,
  type RunState,
} from "../domain/run-state.js";
import type { AgentSessionInfo } from "../ports/agent-executor.js";
import type { Clock } from "../ports/clock.js";
import type { TaskCheckpointWriter } from "./task-execution-contract.js";

export class ReviewSessionCheckpoint {
  private state: RunState;

  public constructor(
    initialState: RunState,
    private readonly taskId: string,
    private readonly attempt: ReviewAttemptState,
    private readonly clock: Clock,
    private readonly writer?: TaskCheckpointWriter,
  ) {
    this.state = initialState;
  }

  public get currentState(): RunState {
    return this.state;
  }

  public async initialize(session: AgentSessionInfo): Promise<void> {
    if (session.sessionId !== this.attempt.sessionId) {
      throw new ConfigurationError(
        `Reviewer 初始化 sessionId 与预期不一致：${session.sessionId}`,
      );
    }
    const current = this.state.tasks[this.taskId]?.reviewAttempts.at(-1);
    if (current?.sessionInitialized === true) {
      return;
    }
    const initialized: ReviewAttemptState = {
      ...this.attempt,
      sessionInitialized: true,
      resolvedModel: session.resolvedModel,
    };
    this.state = replaceCurrentReviewAttempt(
      this.state,
      this.taskId,
      initialized,
      this.clock.now().toISOString(),
    );
    await this.writer?.(
      this.state,
      "Reviewer 会话已初始化",
      {
        sessionId: session.sessionId,
        requestedModel: this.attempt.requestedModel,
        resolvedModel: session.resolvedModel,
      },
    );
  }
}
