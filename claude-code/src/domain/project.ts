/*
 * 编排输入集中在唯一的 orchestration 目录中，不从文件、环境变量或命令行读取可变路径。
 * 初始化器与项目仓储共享同一组路径，保证生成模板和运行时加载不会形成两套约定。
 */
import { z } from "zod";

const ORCHESTRATION_DIRECTORY = "orchestration";

/*
 * SPEC 是唯一项目级上下文，TASK 是严格线性序列中的执行单元。
 * 路径在领域层集中声明，基础设施只能消费该契约，不能自行拼接另一套目录结构。
 */
export const PROJECT_STRUCTURE = Object.freeze({
  orchestrationDirectory: ORCHESTRATION_DIRECTORY,
  specification: `${ORCHESTRATION_DIRECTORY}/SPEC.md`,
  taskDirectory: `${ORCHESTRATION_DIRECTORY}/tasks`,
});

const nonEmptyString = z.string().trim().min(1);

/*
 * TASK ID 同时承担稳定身份与线性位置语义，数字部分至少三位以保证文档目录易读。
 * 真正的排序仍按数值完成，不能把文件系统枚举顺序或字符串比较当作领域规则。
 */
export const TASK_ID_PATTERN = /^TASK-(\d{3,})$/u;

/*
 * TASK 前置元数据只承载任务身份与标题，正文承载完整任务事实。
 * 顺序由 ID 推导，资源限制与人工验收策略不进入任务元数据，避免静态文档形成多事实源。
 */
export const taskDocumentMetadataSchema = z.object({
  id: z.string().trim().regex(TASK_ID_PATTERN),
  title: nonEmptyString,
}).strict();

export const taskDefinitionSchema = taskDocumentMetadataSchema.extend({
  file: nonEmptyString,
}).strict();

export type TaskDocumentMetadata = z.infer<typeof taskDocumentMetadataSchema>;
export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;

/*
 * TextDocument 保存已经完成 UTF-8 校验与 LF 归一化的正文。
 * sourceHash 是规范化正文 UTF-8 字节的 SHA-256，等价 LF/CRLF 源文件得到相同摘要。
 */
export interface TextDocument {
  readonly path: string;
  readonly content: string;
  readonly sourceHash: string;
}

/*
 * LoadedProject 是文件系统项目经过严格校验后的不可变运行输入。
 * tasks 已经按 TASK 数字序号排列，应用层只能消费该线性序列，不能再次解释任务顺序。
 */
export interface LoadedProject {
  readonly tasks: readonly TaskDefinition[];
  readonly projectRoot: string;
  readonly projectHash: string;
  readonly taskDocuments: ReadonlyMap<string, TextDocument>;
  readonly taskContractHashes: ReadonlyMap<string, string>;
  readonly specificationDocument: TextDocument;
  readonly specificationContractHash: string;
}
