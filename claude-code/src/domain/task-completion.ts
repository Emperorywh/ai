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
  readonly specificationDocument: TextDocument;
}

export interface PredecessorCompletion {
  readonly taskId: string;
  readonly commitSha: string;
}

/*
 * TASK 前置元数据已经由严格 Schema 解析，因此契约使用规范化身份并只从原文保留任务正文。
 * 线性顺序属于项目结构而非单任务内容；独立审核是固定流程，不存在任务级覆盖开关。
 */
export function createTaskContractHash(input: TaskContractHashInput): string {
  const contract = {
    /*
     * 第六版完成契约绑定线性任务、强制独立审核和结构化验证证据流程。
     * 显式换代确保旧执行模型产生的提交证据不会被当前系统复用。
     */
    version: 6,
    task: {
      id: input.task.id,
      title: input.task.title,
      file: input.task.file,
      body: extractTaskBody(input.taskDocument.content),
    },
    reviewRequired: true,
    specification: {
      path: input.specificationDocument.path,
      content: input.specificationDocument.content,
    },
  };
  return createHash("sha256")
    .update(JSON.stringify(contract))
    .digest("hex");
}

/*
 * 每个任务只绑定直接前驱的具体完成提交，前驱链会传递覆盖此前的全部完成历史。
 * 根任务使用显式根标记；任一前驱重新执行后，后续任务的指纹都会按线性顺序失效。
 */
export function createPredecessorCompletionFingerprint(
  predecessor: PredecessorCompletion | undefined,
): string {
  const hash = createHash("sha256");
  if (predecessor === undefined) {
    hash.update("ROOT\0");
  } else {
    hash.update(predecessor.taskId);
    hash.update("\0");
    hash.update(predecessor.commitSha);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function extractTaskBody(content: string): string {
  const metadata = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(content);
  return metadata === null ? content : content.slice(metadata[0].length);
}
