/*
 * Manifest 是任务队列的唯一机器契约：依赖、路径边界、门禁和资源上限都在这里显式声明。
 * Markdown 只承载任务叙述，运行状态由独立状态库存储，二者不会相互污染。
 */
import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const gateDefinitionSchema = z.object({
  name: nonEmptyString,
  command: nonEmptyString,
  args: z.array(z.string()).default([]),
  timeoutMinutes: z.number().int().positive().max(240).default(15),
}).strict();

export const taskDefinitionSchema = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  title: nonEmptyString,
  file: nonEmptyString,
  dependsOn: z.array(nonEmptyString).default([]),
  scope: z.object({
    allow: z.array(nonEmptyString).min(1),
    deny: z.array(nonEmptyString).default([]),
  }).strict(),
  gates: z.array(gateDefinitionSchema).min(1),
  maxAttempts: z.number().int().positive().max(10).optional(),
  timeoutMinutes: z.number().int().positive().max(720).optional(),
  manualAcceptance: z.array(nonEmptyString).default([]),
}).strict();

const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

export const taskManifestSchema = z.object({
  version: z.literal(1),
  project: z.object({
    root: nonEmptyString.default("."),
    spec: nonEmptyString.optional(),
    plan: nonEmptyString.optional(),
    contextFiles: z.array(nonEmptyString).default([]),
  }).strict(),
  defaults: z.object({
    maxAttempts: z.number().int().positive().max(10).default(3),
    taskTimeoutMinutes: z.number().int().positive().max(720).default(45),
    maxTurns: z.number().int().positive().max(500).default(80),
    maxBudgetUsd: z.number().positive().optional(),
    model: nonEmptyString.default("sonnet"),
    effort: effortSchema.default("high"),
  }).strict(),
  review: z.object({
    enabled: z.boolean().default(true),
    maxAttempts: z.number().int().positive().max(5).default(2),
    model: nonEmptyString.default("sonnet"),
    effort: effortSchema.default("high"),
    maxTurns: z.number().int().positive().max(200).default(30),
    maxBudgetUsd: z.number().positive().optional(),
  }).strict().default({
    enabled: true,
    maxAttempts: 2,
    model: "sonnet",
    effort: "high",
    maxTurns: 30,
  }),
  git: z.object({
    commitMessagePrefix: nonEmptyString.default("task"),
  }).strict().default({
    commitMessagePrefix: "task",
  }),
  tasks: z.array(taskDefinitionSchema).min(1),
}).strict();

export type GateDefinition = z.infer<typeof gateDefinitionSchema>;
export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;
export type TaskManifest = z.infer<typeof taskManifestSchema>;

export interface TextDocument {
  readonly path: string;
  readonly content: string;
}

export interface LoadedTaskManifest {
  readonly manifest: TaskManifest;
  readonly manifestPath: string;
  readonly projectRoot: string;
  readonly manifestHash: string;
  readonly taskDocuments: ReadonlyMap<string, TextDocument>;
  readonly contextDocuments: readonly TextDocument[];
  readonly protectedPaths: readonly string[];
}

export function getTaskAttemptLimit(
  manifest: TaskManifest,
  task: TaskDefinition,
): number {
  return task.maxAttempts ?? manifest.defaults.maxAttempts;
}

export function getTaskTimeoutMinutes(
  manifest: TaskManifest,
  task: TaskDefinition,
): number {
  return task.timeoutMinutes ?? manifest.defaults.taskTimeoutMinutes;
}
