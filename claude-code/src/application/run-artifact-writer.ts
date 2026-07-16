/*
 * RunArtifactWriter 把终态状态投影为人工验收清单和运行摘要，不参与状态转换。
 * 所有统计均从持久化 attempt 历史聚合，产物不会从控制台日志反向解析运行事实。
 */
import type { LoadedProject } from "../domain/project.js";
import type { RunState } from "../domain/run-state.js";
import type { StateStore } from "../ports/state-store.js";
import type { TimeFormatter } from "../ports/time-formatter.js";
import {
  aggregateRunMetrics,
  aggregateTaskMetrics,
  collectRunModelUsage,
  collectTaskModelUsage,
} from "./run-metrics.js";

export class RunArtifactWriter {
  public constructor(
    private readonly stateStore: StateStore,
    private readonly timeFormatter: TimeFormatter,
  ) {}

  public async write(
    loaded: LoadedProject,
    state: RunState,
  ): Promise<readonly string[]> {
    const runMetrics = aggregateRunMetrics(state);
    const runModels = formatModelUsage(collectRunModelUsage(state));
    const acceptanceChecklist = [
      "# 人工验收清单",
      "",
      `Run ID：${state.runId}`,
      "",
      ...loaded.tasks
        .filter((task) => state.tasks[task.id]?.status === "completed")
        .flatMap((task) => [
          `## ${task.id} ${task.title}`,
          "",
          "- [ ] 按该 TASK 的任务描述完成人工验收",
          "",
        ]),
      "> 编排器没有启动浏览器或执行 UI 自动化；以上项目必须由人工验收。",
      "",
    ].join("\n");
    const summary = [
      "# 运行摘要",
      "",
      `- Run ID：${state.runId}`,
      `- 状态：${state.status}`,
      `- 创建时间：${this.timeFormatter.formatTimestamp(state.createdAt)}`,
      `- 完成时间：${this.timeFormatter.formatTimestamp(state.updatedAt)}`,
      `- Worker 会话：${runMetrics.workerSessions}`,
      `- Reviewer 会话：${runMetrics.reviewerSessions}`,
      `- Agent 轮数：${runMetrics.turns}`,
      `- Agent 成本：$${runMetrics.costUsd.toFixed(4)}`,
      `- Agent 累计耗时：${runMetrics.durationMs}ms`,
      `- API 重试：${runMetrics.apiRetryCount} 次，等待 ${runMetrics.apiRetryDelayMs}ms`,
      `- 工具调用：${runMetrics.toolCalls}`,
      `- 模型握手：${runModels}`,
      "",
      ...loaded.tasks.map((task) => {
        const taskState = state.tasks[task.id];
        if (taskState === undefined) {
          return `- ${task.id}: missing`;
        }
        const metrics = aggregateTaskMetrics(taskState);
        const models = formatModelUsage(collectTaskModelUsage(taskState));
        return `- ${task.id}: ${taskState.status} (${taskState.commitSha ?? "no commit"})，${metrics.turns} 轮，$${metrics.costUsd.toFixed(4)}，${metrics.durationMs}ms，API 重试 ${metrics.apiRetryCount} 次，模型 ${models}`;
      }),
      "",
    ].join("\n");
    return Promise.all([
      this.stateStore.writeArtifact(
        state.runId,
        "manual-acceptance.md",
        acceptanceChecklist,
      ),
      this.stateStore.writeArtifact(state.runId, "summary.md", summary),
    ]);
  }
}

function formatModelUsage(
  usage: readonly {
    readonly requestedModel: string;
    readonly resolvedModel: string;
  }[],
): string {
  return usage.length === 0
    ? "无已完成握手"
    : usage
      .map((model) => `${model.requestedModel} → ${model.resolvedModel}`)
      .join("；");
}
