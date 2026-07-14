/*
 * 所有提示词在一个模块中组装，确保实现、修复和审核共享同一组不可变边界。
 * 上下文按“项目策略、规格、任务、失败反馈”分区，便于人和 AI 快速推导信息来源。
 */
import type {
  LoadedTaskManifest,
  TaskDefinition,
  TextDocument,
} from "../domain/manifest.js";
import type { GateExecutionState } from "../domain/run-state.js";

const writeSafetyRules = `
你只负责当前一个 TASK。严格遵守以下边界：
- 可以自主调用子 Agent、终端、技能和 MCP 完成当前 TASK；不要询问用户，优先依据现有规格和代码自行作出可逆决策。
- 只有缺少无法从项目推导的外部信息、凭据或不可逆产品决策时，才返回 blocked 和 blockingQuestions。
- 不修改 Manifest、SPEC、PLAN、TASK 正文或项目策略文件。
- 不执行 Git commit、push、reset、checkout、clean、rebase 或 merge。
- 不部署，不启动浏览器、UI 自动化、开发服务器或 watch 进程。
- 只修改 TASK scope.allow 覆盖的路径，并主动避开 scope.deny。
- 不把“我认为完成”当作验收；编排器将在会话结束后独立执行门禁。
- 优先长期架构正确性，禁止临时 patch、重复逻辑、隐式状态和跨层耦合。
`;

const reviewSafetyRules = `
你是全新、只读的独立审核会话。不得修改任何文件，不得调用其他 Agent。
依据 SPEC、PLAN、TASK、实际代码和当前 Git diff 判断正确性，不得只复述实现者结论。
重点检查架构边界、数据流、状态流、边界条件、回归风险、测试缺口和路径越界。
`;

export class PromptBuilder {
  public buildImplementation(
    loaded: LoadedTaskManifest,
    task: TaskDefinition,
  ): string {
    return [
      "# 执行目标",
      `实现 TASK ${task.id}：${task.title}`,
      writeSafetyRules,
      this.renderProjectContext(loaded.contextDocuments),
      this.renderTaskContext(loaded, task),
      this.renderScope(task),
      this.renderGates(task),
      "完成修改后返回结构化结果。若存在无法从现有文档推导的关键决策，返回 blocked。",
    ].join("\n\n");
  }

  public buildRepair(
    loaded: LoadedTaskManifest,
    task: TaskDefinition,
    feedback: string,
  ): string {
    return [
      "# 修复目标",
      `修复 TASK ${task.id} 当前工作区中的未完成实现：${task.title}`,
      writeSafetyRules,
      this.renderProjectContext(loaded.contextDocuments),
      this.renderTaskContext(loaded, task),
      this.renderScope(task),
      "# 上一轮客观反馈",
      feedback,
      "先检查当前 diff 和代码状态，只修复根因，随后返回结构化结果。",
    ].join("\n\n");
  }

  public buildResume(
    loaded: LoadedTaskManifest,
    task: TaskDefinition,
  ): string {
    return [
      "# 恢复目标",
      `恢复同一会话中被中断的 TASK ${task.id}：${task.title}`,
      writeSafetyRules,
      this.renderScope(task),
      "原始需求和先前推理已经存在于当前会话，不要重新从头实现。先检查当前 Git diff、未完成的工具操作与代码状态，只继续尚未完成的部分；若工作已经完成，直接返回结构化终态。",
      "若当前落盘状态与会话记忆冲突，以实际文件和 TASK 边界为准。",
      this.renderTaskContext(loaded, task),
    ].join("\n\n");
  }

  public buildReview(
    loaded: LoadedTaskManifest,
    task: TaskDefinition,
    gateResults: readonly GateExecutionState[],
    changedFiles: readonly string[],
    diff: string,
  ): string {
    return [
      "# 审核目标",
      `审核 TASK ${task.id}：${task.title}`,
      reviewSafetyRules,
      this.renderProjectContext(loaded.contextDocuments),
      this.renderTaskContext(loaded, task),
      this.renderScope(task),
      "# 外部门禁结果",
      this.renderGateResults(gateResults),
      "# 实际变更文件",
      changedFiles.map((file) => `- ${file}`).join("\n"),
      "# Git diff",
      diff || "<diff 为空；请直接读取新增文件>",
      "请读取所有实际变更文件及相关代码。只有没有 critical/high/medium 正确性问题时才返回 approved。",
    ].join("\n\n");
  }

  private renderProjectContext(documents: readonly TextDocument[]): string {
    if (documents.length === 0) {
      return "# 项目策略\n未声明额外项目策略文件。";
    }

    return [
      "# 项目策略",
      ...documents.map((document) =>
        `## ${document.path}\n\n${document.content}`),
    ].join("\n\n");
  }

  private renderTaskContext(
    loaded: LoadedTaskManifest,
    task: TaskDefinition,
  ): string {
    const taskDocument = loaded.taskDocuments.get(task.id);
    if (taskDocument === undefined) {
      throw new Error(`任务 ${task.id} 缺少正文`);
    }

    return [
      "# TASK 正文",
      `来源：${taskDocument.path}`,
      taskDocument.content,
    ].join("\n\n");
  }

  private renderScope(task: TaskDefinition): string {
    return [
      "# 路径边界",
      `允许修改：\n${task.scope.allow.map((item) => `- ${item}`).join("\n")}`,
      `禁止修改：\n${task.scope.deny.map((item) => `- ${item}`).join("\n") || "- 无额外声明"}`,
    ].join("\n\n");
  }

  private renderGates(task: TaskDefinition): string {
    const lines = task.gates.map((gate) =>
      `- ${gate.name}: ${[gate.command, ...gate.args].join(" ")}`);
    return `# 外部验收门禁\n${lines.join("\n")}`;
  }

  private renderGateResults(results: readonly GateExecutionState[]): string {
    return results.map((result) => [
      `## ${result.name}`,
      `退出码：${result.exitCode ?? "无"}`,
      `超时：${result.timedOut ? "是" : "否"}`,
      `stdout:\n${result.stdout || "<empty>"}`,
      `stderr:\n${result.stderr || "<empty>"}`,
    ].join("\n")).join("\n\n");
  }
}
