/*
 * 任务完成契约只包含会改变“任务是否仍然有效”的事实，不包含模型、预算、重试次数等执行策略。
 * 前驱完成指纹通过唯一规范哈希入口计算：版本化 strict Schema + JCS + SHA-256。
 */
import { z } from "zod";
import type { CanonicalHashService } from "../ports/canonical-hash.js";
import { defineCanonicalSchema, type CanonicalValue } from "./canonical-schema.js";
import { TASK_ID_PATTERN } from "./project.js";

export interface PredecessorCompletion {
  readonly taskId: string;
  readonly commitSha: string;
}

/*
 * Git 提交 OID 使用完整小写十六进制；SHA-1（40）与 SHA-256（64）对象格式都按原样接受，不截断不混用。
 */
const gitCommitOidSchema = z.string().regex(
  /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u,
  "Git 提交 OID 必须是完整小写十六进制",
);

/*
 * 每个任务只绑定直接前驱的具体完成提交，前驱链会传递覆盖此前的全部完成历史。
 * 根任务使用显式 "root" 分支；联合分支之外的值（多余字段、缺失字段、未知标记）一律 fail closed。
 */
export const predecessorCompletionProjectionSchema = defineCanonicalSchema(1, {
  predecessor: z.union([
    z.literal("root"),
    z.strictObject({
      taskId: z.string().regex(TASK_ID_PATTERN),
      commitSha: gitCommitOidSchema,
    }),
  ]),
});
export type PredecessorCompletionProjection = CanonicalValue<
  typeof predecessorCompletionProjectionSchema
>;

/*
 * 任一前驱重新执行后，后续任务的指纹都会按线性顺序失效。
 * 指纹只由规范投影决定，不存在第二套可互换的拼接算法。
 */
export function createPredecessorCompletionFingerprint(
  predecessor: PredecessorCompletion | undefined,
  canonicalHash: CanonicalHashService,
): string {
  return canonicalHash.digestStructured(predecessorCompletionProjectionSchema, {
    schemaVersion: predecessorCompletionProjectionSchema.schemaVersion,
    predecessor: predecessor === undefined
      ? "root"
      : { taskId: predecessor.taskId, commitSha: predecessor.commitSha },
  });
}
