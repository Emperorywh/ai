/*
 * 事件日志记录稳定的应用事件，不依赖 Claude SDK 私有 transcript 格式。
 * 终端展示和 JSONL 持久化可以组合使用，但都不能反向修改运行状态。
 */
export interface RunEvent {
  readonly timestamp: string;
  readonly runId: string;
  readonly taskId?: string;
  readonly type: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface EventLogger {
  log(event: RunEvent): Promise<void>;
}
