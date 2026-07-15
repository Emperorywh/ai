/*
 * 编排输入集中在唯一的 orchestration 目录中，不从文件、环境变量或命令行读取可变路径。
 * 初始化器与项目仓储共享同一组路径，保证生成模板和运行时加载不会形成两套约定。
 */
import { z } from "zod";

const ORCHESTRATION_DIRECTORY = "orchestration";

/*
 * SPEC 是唯一项目级上下文，TASK 是可独立调度的执行单元。
 * 路径在领域层集中声明，基础设施只能消费该契约，不能自行拼接另一套目录结构。
 */
export const PROJECT_STRUCTURE = Object.freeze({
  orchestrationDirectory: ORCHESTRATION_DIRECTORY,
  specification: `${ORCHESTRATION_DIRECTORY}/SPEC.md`,
  taskDirectory: `${ORCHESTRATION_DIRECTORY}/tasks`,
});

const nonEmptyString = z.string().trim().min(1);

/*
 * TASK 前置元数据只承载任务身份、依赖、单任务熔断和人工验收事实。
 * 系统级模型、审核与 Git 策略不允许从 TASK 反向覆盖，避免执行规则产生多事实源。
 */
export const taskDocumentMetadataSchema = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  title: nonEmptyString,
  dependsOn: z.array(nonEmptyString),
  maxAttempts: z.number().int().positive().optional(),
  timeoutMinutes: z.number().int().positive().optional(),
  manualAcceptance: z.array(nonEmptyString).default([]),
}).strict();

export const taskDefinitionSchema = taskDocumentMetadataSchema.extend({
  file: nonEmptyString,
}).strict();

export type TaskDocumentMetadata = z.infer<typeof taskDocumentMetadataSchema>;
export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;

export interface TextDocument {
  readonly path: string;
  readonly content: string;
}

/*
 * LoadedProject 是文件系统项目经过严格校验后的不可变运行输入。
 * 单数 specificationDocument 明确表达唯一上下文事实源，避免重新引入可选策略文件集合。
 */
export interface LoadedProject {
  readonly tasks: readonly TaskDefinition[];
  readonly projectRoot: string;
  readonly projectHash: string;
  readonly taskDocuments: ReadonlyMap<string, TextDocument>;
  readonly taskContractHashes: ReadonlyMap<string, string>;
  readonly specificationDocument: TextDocument;
}

export function getTaskAttemptLimit(
  task: TaskDefinition,
): number | undefined {
  return task.maxAttempts;
}

export function getTaskTimeoutMinutes(
  task: TaskDefinition,
): number | undefined {
  return task.timeoutMinutes;
}
