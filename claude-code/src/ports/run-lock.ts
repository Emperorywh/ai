/*
 * 独占锁是“单并发”的进程级保障，防止两个 CLI 实例竞争同一 Git worktree。
 * 任务内部的顺序循环保证逻辑单并发，worktree 锁覆盖兄弟项目、误操作和定时任务重复启动。
 */
export interface RunLockHandle {
  release(): Promise<void>;
}

export interface RunLock {
  acquire(runId: string): Promise<RunLockHandle>;
}
