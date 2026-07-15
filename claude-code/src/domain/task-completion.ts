/*
 * 任务完成契约只包含会改变“任务是否仍然有效”的事实，不包含模型、预算、重试次数等执行策略。
 * 自主 Worker 的能力不再由路径或命令清单塑形，需求、上下文与审核策略是完成定义的全部输入。
 */
import { createHash } from "node:crypto";
import type {
  TaskDefinition,
  TextDocument,
} from "./project.js";

export interface TaskContractHashInput {
  readonly task: TaskDefinition;
  readonly taskDocument: TextDocument;
  readonly contextDocuments: readonly TextDocument[];
}

export interface DependencyCompletion {
  readonly taskId: string;
  readonly commitSha: string;
}

/*
 * TASK 前置元数据已经由严格 Schema 解析，因此契约使用规范化字段，并只从原文保留任务正文。
 * maxAttempts 和 timeoutMinutes 被有意排除，它们只控制单任务执行过程，不改变完成定义。
 * 独立审核是系统固定流程，契约版本显式绑定该语义，不存在项目级开关。
 */
export function createTaskContractHash(input: TaskContractHashInput): string {
  const contract = {
    /*
     * 第三版完成契约移除外部配置输入，并固定使用独立审核流程。
     * 显式换代确保旧配置体系产生的提交证据不会在新执行模型下被错误复用。
     */
    version: 3,
    task: {
      id: input.task.id,
      title: input.task.title,
      file: input.task.file,
      dependsOn: input.task.dependsOn,
      manualAcceptance: input.task.manualAcceptance,
      body: extractTaskBody(input.taskDocument.content),
    },
    reviewRequired: true,
    contextDocuments: [...input.contextDocuments]
      .sort((left, right) => compareText(left.path, right.path))
      .map((document) => ({
        path: document.path,
        content: document.content,
      })),
  };
  return createHash("sha256")
    .update(JSON.stringify(contract))
    .digest("hex");
}

/*
 * 下游任务绑定依赖任务的具体完成提交，而不是只绑定 completed 布尔值。
 * 任一依赖重新执行并产生新提交时，下游指纹都会改变，从而沿 DAG 确定性传播失效。
 */
export function createDependencyCompletionFingerprint(
  dependencies: readonly DependencyCompletion[],
): string {
  const hash = createHash("sha256");
  for (const dependency of dependencies) {
    hash.update(dependency.taskId);
    hash.update("\0");
    hash.update(dependency.commitSha);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function extractTaskBody(content: string): string {
  const metadata = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(content);
  return metadata === null ? content : content.slice(metadata[0].length);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
