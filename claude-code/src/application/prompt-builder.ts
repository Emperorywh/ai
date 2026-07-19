/*
 * 所有提示词在一个模块中组装，确保实现、修复和审核共享同一组不可变边界。
 * 上下文按“规格、任务、失败反馈”分区，唯一事实来源让人和 AI 都能快速推导约束来源。
 */
import type {
  LoadedProject,
  TaskDefinition,
  TextDocument,
} from "../domain/project.js";
import type { VerificationEvidence } from "../domain/agent-result.js";
import type { ProjectContextManifest } from "../domain/project-context.js";
import type { WorkerBlockerReport } from "../domain/run-state.js";
const writeSafetyRules = `
你只负责当前一个 TASK。严格遵守以下边界：
- 可以自主调用子 Agent、终端、技能和 MCP 完成当前 TASK；不要询问用户，优先依据现有规格和代码自行作出可逆决策。
- 只有缺少无法从项目推导的外部信息、凭据或不可逆产品决策时，才返回 blocked 和 blockingQuestions。
- 返回 blocked 前必须先穷尽项目内代码、文档、可用工具和所有不依赖该外部事实的当前 TASK 工作；不得把尚未尝试、可以修复或可以验证的工作包装成人工问题。
- 人工浏览器、视觉和发布验收发生在代码候选完成之后，不能单独作为实现阻塞理由；同时不得伪造人工核对记录、外部数据、凭据或合规结论。
- Git 只用于 status、diff、log、show 等读取；不执行任何会改变工作区、索引、引用、历史或远端的 Git 操作。
- 不部署，不启动浏览器、UI 自动化、开发服务器或 watch 进程。
- 优先长期架构正确性，禁止临时 patch、重复逻辑、隐式状态和跨层耦合。
`;

const reviewSafetyRules = `
你是全新、只读的独立审核会话。不得修改任何文件，不得调用其他 Agent。
依据 SPEC、TASK、实际代码和当前 Git diff 判断正确性，不得只复述实现者结论。
重点检查架构边界、数据流、状态流、边界条件、回归风险和测试缺口。
`;

/*
 * Reviewer 必须知道候选冻结与后续提交的确定性语义，否则会把提交前正常存在的 untracked 文件
 * 误判为“可能没有进入 checkpoint”，并把本应审核或修复的问题错误升级为人工阻塞。
 * 状态协议同时把可修复缺陷、真正外部阻塞和可逆实现选择分开，避免 blocked 成为逃避判断的兜底值。
 */
const reviewDecisionProtocol = `
# 审核状态与候选生命周期协议
- “实际变更文件”是编排器已经冻结并校验指纹的完整候选，包含 tracked、untracked 和 deleted 文件；审核通过后，编排器会把这份候选原子提交。提交前看到 \`git status\` 的 \`??\` 是新增文件的正常状态，不代表文件会漏出 checkpoint，不得因此询问人工确认是否纳入提交。
- 发现可以通过修改代码、资产、测试或文档解决的 critical/high/medium 正确性问题时返回 rejected，并写入 findings；候选偏离明确 SPEC/TASK 也属于 finding，不得改写成“是否接受偏离”的人工问题。
- 只有正确性确实无法判断，且缺少的事实属于项目内无法推导的外部信息、凭据或不可逆产品决策时，才返回 blocked；blockingQuestions 必须准确指出缺少的外部事实。
- 对项目已有证据支持的可逆实现选择直接作出审核判断：满足契约就批准，不满足就拒绝。不得仅因希望维护者确认偏好而返回 blocked。
- 浏览器与 UI 验收按系统边界留给人工，不会阻止代码候选进入提交；只评估自动化证据与静态审核能覆盖的正确性风险。
`;

/*
 * Worker 的 blocked 只是待审核声明：Reviewer 必须区分真正外部依赖、尚未穷尽的项目内工作和纯人工验收。
 * 特别禁止用 approved 接受一个未完成候选；应用层仍会把这种协议误用归一化为 rejected 并送回 Worker。
 */
const workerBlockerReviewProtocol = `
# Worker 阻塞独立审计协议
- 当前 Worker 没有报告实现完成；本轮目标是审计它的 blocked 声明，而不是批准代码提交。
- 先检查 TASK、SPEC、现有代码、Worker 已落盘候选和可用的非交互工具，判断 blockingQuestions 是否真的是项目内无法推导的外部信息、凭据或不可逆产品决策。
- 如果仍有可通过代码、资产、测试、文档、可用工具或可逆实现选择推进的工作，返回 rejected，并至少写入一条 medium 或更高 finding，明确告诉 Worker 下一步应完成什么。
- 人工浏览器、视觉或发布验收通常发生在代码候选完成之后，不能单独证明实现阶段需要 blocked；应让 Worker 先完成可自动实现和静态验证的交付物。
- 只有核心正确性确实依赖当前无法取得的外部事实，且继续实现会迫使 Worker 伪造数据、凭据、人工记录或不可逆决策时，才返回 blocked。
- 本轮不得返回 approved；阻塞不成立时必须返回 rejected，阻塞成立时必须返回 blocked。
`;

export class PromptBuilder {
  public buildImplementation(
    loaded: LoadedProject,
    task: TaskDefinition,
    projectContext: ProjectContextManifest,
  ): string {
    return [
      "# 执行目标",
      `实现 TASK ${task.id}：${task.title}`,
      writeSafetyRules,
      this.renderSpecification(loaded.specificationDocument),
      this.renderProjectContext(projectContext),
      this.renderTaskContext(loaded, task),
      this.renderVerificationProtocol(),
      "完成修改后只返回结构化结果；verifications 只填写实际执行过的命令及真实结果。若存在无法从现有文档推导的关键决策，返回 blocked。",
    ].join("\n\n");
  }

  public buildRepair(
    loaded: LoadedProject,
    task: TaskDefinition,
    feedback: string,
    projectContext: ProjectContextManifest,
  ): string {
    return [
      "# 修复目标",
      `修复 TASK ${task.id} 当前工作区中的未完成实现：${task.title}`,
      writeSafetyRules,
      this.renderSpecification(loaded.specificationDocument),
      this.renderProjectContext(projectContext),
      this.renderTaskContext(loaded, task),
      "# 上一轮客观反馈",
      feedback,
      this.renderVerificationProtocol(),
      "先检查当前 diff 和代码状态，只修复根因，随后只返回结构化结果。",
    ].join("\n\n");
  }

  public buildResume(
    loaded: LoadedProject,
    task: TaskDefinition,
    feedback: string,
    projectContext: ProjectContextManifest,
  ): string {
    return [
      "# 恢复目标",
      `恢复同一会话中被中断的 TASK ${task.id}：${task.title}`,
      writeSafetyRules,
      "原始需求和先前推理已经存在于当前会话，不要重新从头实现。先检查当前 Git diff、未完成的工具操作与代码状态，只继续尚未完成的部分；若工作已经完成，直接返回结构化终态。",
      "若当前落盘状态与会话记忆冲突，以实际文件和 TASK 边界为准。",
      "# 恢复原因与客观反馈",
      feedback,
      this.renderProjectContext(projectContext),
      this.renderTaskContext(loaded, task),
      this.renderVerificationProtocol(),
    ].join("\n\n");
  }

  public buildReview(
    loaded: LoadedProject,
    task: TaskDefinition,
    changedFiles: readonly string[],
    diff: string,
    verifications: readonly VerificationEvidence[],
    projectContext: ProjectContextManifest,
    workerBlocker?: WorkerBlockerReport,
  ): string {
    return [
      "# 审核目标",
      `审核 TASK ${task.id}：${task.title}`,
      reviewSafetyRules,
      this.renderSpecification(loaded.specificationDocument),
      this.renderProjectContext(projectContext),
      this.renderTaskContext(loaded, task),
      reviewDecisionProtocol,
      ...(workerBlocker === undefined
        ? []
        : [
            workerBlockerReviewProtocol,
            "# Worker 阻塞报告",
            this.renderWorkerBlocker(workerBlocker),
          ]),
      "# 实际变更文件",
      changedFiles.map((file) => `- ${file}`).join("\n"),
      "# Git diff",
      diff || "<diff 为空；请直接读取新增文件>",
      "# 实现者验证证据",
      this.renderVerificationEvidence(verifications),
      "先依据紧凑 diff 定位风险，再按需读取变更文件及直接依赖；不要机械重复读取已经足够明确的内容。只有没有 critical/high/medium 正确性问题时才返回 approved。",
    ].join("\n\n");
  }

  /*
   * SPEC 是不可缺省的项目级上下文，加载器已经保证其存在且非空。
   * 提示词层只负责渲染，不提供空规格 fallback，也不重新解释文件发现规则。
   */
  private renderSpecification(document: TextDocument): string {
    return [
      "# 项目规格",
      `来源：${document.path}`,
      document.content,
    ].join("\n\n");
  }

  private renderTaskContext(
    loaded: LoadedProject,
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

  /*
   * 项目清单只提供导航入口和可用脚本，源码事实仍由 Agent 按需读取。
   * 指纹便于日志与会话关联同一份上下文，截断标记则阻止 Agent 把有限清单误当成完整仓库。
   */
  private renderProjectContext(context: ProjectContextManifest): string {
    const scripts = context.scripts.length === 0
      ? "- <未发现 package.json scripts>"
      : context.scripts
        .map((script) => `- ${script.name}: ${script.command}`)
        .join("\n");
    const entries = context.entries.length === 0
      ? "- <项目根目录为空>"
      : context.entries.map((entry) => `- ${entry}`).join("\n");
    const diagnostics = context.diagnostics.length === 0
      ? "- <无>"
      : context.diagnostics.map((diagnostic) => `- ${diagnostic}`).join("\n");
    return [
      "# 确定性项目清单",
      `上下文指纹：${context.fingerprint}`,
      `包管理器：${context.packageManager ?? "未识别"}`,
      `## 可用脚本${context.scriptsTruncated ? "（已截断）" : ""}`,
      scripts,
      `## 文件树（共展示 ${context.entries.length} 项${context.truncated ? "，已截断" : ""}）`,
      entries,
      "## 上下文诊断",
      diagnostics,
      "该清单仅用于导航；实现与审核必须按需读取相关源码和直接依赖。",
    ].join("\n");
  }

  /*
   * 验证协议将“何时执行什么范围的检查”固定为可复用策略，避免 Agent 在代码未变化时反复跑全量套件。
   * UI 与浏览器验收仍由人工负责，Worker 只执行与当前 TASK 相关的非交互命令。
   */
  private renderVerificationProtocol(): string {
    return [
      "# 验证协议",
      "- 仅在确有必要时执行一次基线检查；修改过程中优先运行受影响模块的定向检查。",
      "- 实现稳定后执行一次适用的全量非交互检查；代码未变化时不得机械重复同一全量命令。",
      "- 不启动浏览器、UI 自动化、开发服务器或 watch 进程；这些验收明确留给人工。",
      "- 结构化 verifications 只记录实际执行的命令、范围、通过/失败状态和简短事实摘要。",
    ].join("\n");
  }

  private renderVerificationEvidence(
    verifications: readonly VerificationEvidence[],
  ): string {
    if (verifications.length === 0) {
      return "<实现者未报告可审计的命令验证；请将其作为测试覆盖风险纳入审核>";
    }
    return verifications.map((verification) =>
      `- [${verification.status}] [${verification.scope}] ${verification.command}：${verification.summary}`
    ).join("\n");
  }

  /*
   * 摘要和问题来自已经通过结构化 Schema 的持久化事实，这里只负责确定性投影。
   * 空问题数组仍显式展示，避免 Reviewer 把缺少具体问题误认为日志截断或上下文丢失。
   */
  private renderWorkerBlocker(report: WorkerBlockerReport): string {
    const questions = report.blockingQuestions.length === 0
      ? "- <Worker 未提供具体 blockingQuestions>"
      : report.blockingQuestions.map((question) => `- ${question}`).join("\n");
    return [
      `摘要：${report.summary}`,
      "阻塞问题：",
      questions,
    ].join("\n");
  }

}
