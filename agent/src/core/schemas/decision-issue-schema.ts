/**
 * Core 决策与问题机器字段 Schema（Readme.md §6.6 DECISIONS / §6.7 ISSUES）。
 *
 * 本文件校验两类长期记录的机器字段：
 *   - DECISIONS.md 每条决策（§6.6）；
 *   - ISSUES.md 每个问题（§6.7）。
 * 同时也是 `.result.md` 的 `global_update_requests.decisions / issues` 提议项的校验入口
 * （§10）：Task Executor 提议时 `id` 留空，由 Orchestrator 回写时分配（`DEC-XXX` /
 * `ISS-XXX`），分配后再以同一 Schema 复校。字段集与 §6.6 / §6.7「至少包括」逐字对齐。
 *
 * 设计约束：
 *   - 仅依赖 zod 与 src/core/enums.ts，零反向依赖（AGENTS.md §2）。
 *   - 复用 enums.ts 的 DecisionStatusSchema / IssueStatusSchema /
 *     IssueSeveritySchema / ScopeSchema，不重复声明枚举取值（TASK-002 单一来源决策）。
 *   - Zod schema 为单一来源，TS 类型由 z.infer 派生，杜绝类型与校验漂移。
 *
 * 字段语义要点：
 *   - id：允许空串（Task Executor 提议时留空）；不在此处约束 `DEC-XXX` / `ISS-XXX`
 *     格式——id 分配是 application 层职责（任务 §12 风险点），Schema 只负责结构。
 *   - created_from_task：复用 ScopeSchema（`SPEC` | `ARCHITECTURE` | `TASK-\d+`），
 *     表示该记录由哪个任务 / 阶段产生（§6.6 / §6.7）。
 *   - scope：记录的「影响范围」，取自由文本（如 `core` / `api` / `cli` 等模块或层级
 *     标识），与 created_from_task（来源任务）语义不同。详见 .result.md issue：
 *     任务 §8 字面「scope 用枚举」与本实现（自由文本）存在张力，待 Orchestrator 确认。
 */
import { z } from 'zod'
import {
  DecisionStatusSchema,
  IssueSeveritySchema,
  IssueStatusSchema,
  ScopeSchema,
} from '../enums.js'

/* ============================================================ *
 * 决策记录（Readme.md §6.6 DECISIONS.md 机器字段）
 * ============================================================ */

/**
 * 决策记录 schema。
 *
 * 覆盖 §6.6「至少包括」全部 8 个机器字段，全部必填（缺失即拒）：
 *   id / title / status / scope / created_from_task /
 *   decision / rationale / consequences。
 *
 * - id 允许空串：提议态由 Task Executor 留空，Orchestrator 回写分配 `DEC-XXX`。
 * - status 复用 DecisionStatusSchema（proposed / accepted / superseded）。
 * - created_from_task 复用 ScopeSchema（任务 id 或 SPEC / ARCHITECTURE）。
 * - scope 为自由文本影响范围（非空），见文件头注释。
 */
export const DecisionSchema = z.object({
  id: z.string(),
  title: z.string().min(1, 'decision.title 必填且非空'),
  status: DecisionStatusSchema,
  scope: z.string().min(1, 'decision.scope 必填且非空'),
  created_from_task: ScopeSchema,
  decision: z.string().min(1, 'decision.decision 必填且非空'),
  rationale: z.string().min(1, 'decision.rationale 必填且非空'),
  consequences: z.string().min(1, 'decision.consequences 必填且非空'),
})
export type Decision = z.infer<typeof DecisionSchema>

/* ============================================================ *
 * 问题记录（Readme.md §6.7 ISSUES.md 机器字段）
 * ============================================================ */

/**
 * 问题记录 schema。
 *
 * 覆盖 §6.7「至少包括」全部 8 个机器字段，全部必填（缺失即拒）：
 *   id / title / status / severity / scope / created_from_task /
 *   owner / recommended_action。
 *
 * - id 允许空串：提议态由 Task Executor 留空，Orchestrator 回写分配 `ISS-XXX`。
 * - status 复用 IssueStatusSchema（open / resolved）。
 * - severity 复用 IssueSeveritySchema（low / medium / high / critical）。
 * - created_from_task 复用 ScopeSchema（任务 id 或 SPEC / ARCHITECTURE）。
 * - owner 允许空串：尚未指派责任人的问题（如需人工确认）用空串表达（§10 示例、
 *   TASK-003 提议项均为 `owner: ""`）。
 * - scope 为自由文本影响范围（非空），见文件头注释。
 */
export const IssueSchema = z.object({
  id: z.string(),
  title: z.string().min(1, 'issue.title 必填且非空'),
  status: IssueStatusSchema,
  severity: IssueSeveritySchema,
  scope: z.string().min(1, 'issue.scope 必填且非空'),
  created_from_task: ScopeSchema,
  owner: z.string(),
  recommended_action: z.string().min(1, 'issue.recommended_action 必填且非空'),
})
export type Issue = z.infer<typeof IssueSchema>
