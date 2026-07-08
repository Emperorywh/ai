/**
 * Core 审查结论 Schema（.review.md frontmatter，Readme.md §15）。
 *
 * 本文件是 `.review.md` frontmatter 的结构校验入口：Reviewer 审查完毕后把
 * 审查结论写入 frontmatter（§15），Orchestrator 读取后据 review_result 映射
 * 任务状态（TASK-008 状态映射的评审分支，由 TASK-017 编排实现）。
 *
 * 设计约束：
 *   - 仅依赖 zod 与 src/core/enums.ts，零反向依赖（AGENTS.md §2）。
 *   - 复用 enums.ts 的 ReviewResultSchema / TaskIdSchema，不重复声明枚举取值
 *     或任务 id 正则（TASK-002 单一来源决策）。
 *   - Zod schema 为单一来源，TS 类型由 z.infer 派生，杜绝类型与校验漂移。
 *
 * 边界（任务 §7）：
 *   - 不实现「审查结论 → 任务状态」映射（TASK-008 评审分支，由 TASK-017 编排）。
 *   - 不实现 .review.md 读写（TASK-011）。
 *
 * 字段语义要点：
 *   - review_result 复用 ReviewResultSchema（approved / rejected /
 *     needs-human-confirmation / skipped）；skipped 专用于 no_review: true 时
 *     Orchestrator 生成的占位审查（§15），Reviewer 不介入。
 *   - reviewed_at 用 z.string().datetime()（ISO8601 UTC，§8）。
 *   - required_changes / findings 为字符串数组；§12 软约束「approved / skipped 时
 *     required_changes 应为空」不在 Schema 硬拒，保留弹性，由上层编排约束。
 */
import { z } from 'zod'
import { ReviewResultSchema, TaskIdSchema } from '../enums.js'

/* ============================================================ *
 * .review.md frontmatter（Readme.md §15）
 * ============================================================ */

/**
 * 审查结论 frontmatter schema（Readme.md §15）。
 *
 * 覆盖 §15 模板全部机器字段：
 *   - task_id：复用 enums.ts 的 TaskIdSchema（TASK-\d+）。
 *   - review_result：复用 ReviewResultSchema（approved / rejected /
 *     needs-human-confirmation / skipped）。
 *   - reviewer：审查者标识（如 reviewer-agent / orchestrator），非空。
 *   - reviewed_at：ISO8601 UTC 时间戳（§8）。
 *   - required_changes：必须修改项，rejected / needs-human-confirmation 时填写。
 *   - findings：审查发现清单，允许空。
 *
 * 注意（任务 §12 风险点）：required_changes 在 approved / skipped 时应为空
 * 属软约束，本 Schema 不硬拒，保留弹性；合法性由上层编排（TASK-017）约束。
 */
export const ReviewFrontmatterSchema = z.object({
  task_id: TaskIdSchema,
  review_result: ReviewResultSchema,
  reviewer: z.string().min(1, 'reviewer 必填且非空'),
  reviewed_at: z.string().datetime(),
  required_changes: z.array(z.string()),
  findings: z.array(z.string()),
})
export type ReviewFrontmatter = z.infer<typeof ReviewFrontmatterSchema>
