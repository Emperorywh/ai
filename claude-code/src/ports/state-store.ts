/*
 * 状态存储只保存运行快照和可审计产物，不参与任务调度决策。
 * 实现必须保证单次保存不会暴露半写入 JSON，崩溃后可从最后一个完整快照恢复。
 */
import type { RunState } from "../domain/run-state.js";

export interface StateStore {
  save(state: RunState): Promise<void>;
  load(runId: string): Promise<RunState | undefined>;
  getLatestRunId(): Promise<string | undefined>;
  writeArtifact(runId: string, name: string, content: string): Promise<string>;
}
