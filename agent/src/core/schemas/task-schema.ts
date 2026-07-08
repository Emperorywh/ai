/**
 * Core 任务文件 frontmatter Schema（Readme.md §9 任务文件模板）。
 *
 * 本文件是任务文件读取后的校验入口：frontmatter 解析器（TASK-010）读出
 * YAML 对象后，交由 TaskFrontmatterSchema 做结构与枚举校验；任务状态机
 * （TASK-007）消费其 status 字段；SQLite 索引（TASK-014）消费 id / layer /
 * depends_on / allowed_paths / permissions 等字段。
 *
 * 设计约束：
 *   - 仅依赖 zod 与 src/core/enums.ts，零反向依赖（AGENTS.md §2）。
 *   - 复用 enums.ts 的 LayerSchema / TaskStatusSchema / PermissionSchema /
 *     TaskIdSchema，不重复声明枚举取值或 id 正则（TASK-002 单一来源决策）。
 *   - Zod schema 为单一来源，TS 类型由 z.infer 派生，杜绝类型与校验漂移。
 *
 * 字段必填性（任务 §11 验收「缺必填字段被拒」）：
 *   - id / title / status / layer / allowed_paths / verification /
 *     context_pack / workflow_outputs 为必填，缺失即拒。
 *   - depends_on / forbidden_paths / permissions / no_review / restart_on_retry
 *     缺失时取安全默认（[] / false），与 Readme §9 模板默认值一致。
 */
import { z } from 'zod'
import {
  LayerSchema,
  PermissionSchema,
  TaskIdSchema,
  TaskStatusSchema,
} from '../enums.js'

/* ============================================================ *
 * Context Pack 清单（Readme.md §8 上下文包）
 * ============================================================ */

/**
 * Context Pack 清单 schema。
 *
 * context_pack 只声明 Task Executor 的读取范围（不管写），三子字段均为
 * 字符串数组，允许空数组（§8 裁剪规则）。必读核心文档不计入 required_docs，
 * 由上层与 required_docs 取并集注入（§8「必读核心 ∪ context_pack」）。
 */
export const ContextPackSchema = z.object({
  required_docs: z.array(z.string()),
  optional_doc_excerpts: z.array(z.string()),
  source_files: z.array(z.string()),
})
export type ContextPack = z.infer<typeof ContextPackSchema>

/* ============================================================ *
 * 工作流输出声明（Readme.md §9 任务文件模板）
 * ============================================================ */

/**
 * 任务工作流输出声明 schema。
 *
 * result_file 是任务唯一允许写入的结果文件路径（.result.md），必填且非空；
 * 它独立于 context_pack（后者只管读），由 Orchestrator 在合并前回填
 * execution_commits 等字段（§10）。.result.md 默认允许写入，不需要出现在
 * 业务 allowed_paths 中（§3.2）。
 */
export const WorkflowOutputsSchema = z.object({
  result_file: z.string().min(1, 'workflow_outputs.result_file 必填且非空'),
})
export type WorkflowOutputs = z.infer<typeof WorkflowOutputsSchema>

/* ============================================================ *
 * 任务文件 frontmatter（Readme.md §9 任务文件模板）
 * ============================================================ */

/**
 * 任务文件 frontmatter schema。
 *
 * 覆盖 §9 模板全部机器字段：
 *   - id：复用 enums.ts 的 TaskIdSchema（开放集合，形如 TASK-\d+，至少一位数字）。
 *   - status：接受全部合法 TaskStatus，不强制初值（初值 draft 由 PLAN 保证，
 *     见任务 §8）。
 *
 * 注意（任务 §12 风险点）：本 verification 是字符串数组（任务文件模板形态），
 * 与 .result.md 里的对象数组形态（§10）不是同一结构，切勿混用。
 */
export const TaskFrontmatterSchema = z.object({
  id: TaskIdSchema,
  title: z.string().min(1, 'title 必填且非空'),
  status: TaskStatusSchema,
  layer: LayerSchema,
  depends_on: z.array(TaskIdSchema).default([]),
  allowed_paths: z.array(z.string()),
  forbidden_paths: z.array(z.string()).default([]),
  permissions: z.array(PermissionSchema).default([]),
  no_review: z.boolean().default(false),
  restart_on_retry: z.boolean().default(false),
  verification: z.array(z.string()),
  context_pack: ContextPackSchema,
  workflow_outputs: WorkflowOutputsSchema,
})
export type TaskFrontmatter = z.infer<typeof TaskFrontmatterSchema>
