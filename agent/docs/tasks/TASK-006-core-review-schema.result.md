---
task_id: TASK-006
execution_status: completed
modified_files:
  - src/core/index.ts
created_files:
  - src/core/schemas/review-schema.ts
  - test/core/schemas/review-schema.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "tsc --noEmit，0 错误（strict + noUncheckedIndexedAccess）"
  - command: npm test -- core/schemas/review-schema
    result: passed
    notes: "vitest run，1 文件 20 用例全部通过"
  - command: npm run lint
    result: passed
    notes: "eslint src test，无 error / warning"
  - command: npm test
    result: passed
    notes: "全量 5 文件 160 用例（enums 26 + task-schema 28 + decision-issue-schema 40 + result-schema 46 + review-schema 20）全通过，无回归"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: replace
      content: "TASK-001（项目脚手架与基础约束）已完成。\nTASK-002（Core 领域原语与枚举）已完成：src/core/enums.ts 定义全部领域枚举 + Zod schema，26 项单测。\nTASK-003（Core 任务 frontmatter Schema）已完成：TaskFrontmatterSchema / ContextPackSchema / WorkflowOutputsSchema，28 项单测。\nTASK-004（Core 决策与问题机器字段 Schema）已完成：DecisionSchema / IssueSchema，40 项单测。\nTASK-005（Core 执行结果 Schema）已完成：ResultFrontmatterSchema（.result.md frontmatter）+ 子 Schema，46 项单测。\nTASK-006（Core 审查结论 Schema）已完成：ReviewFrontmatterSchema（.review.md frontmatter），复用 enums.ts 的 ReviewResultSchema / TaskIdSchema，20 项单测。"
    - section: "当前系统可用能力"
      mode: replace
      content: "Core 五份 type 资产齐备（枚举 + 任务 Schema + 决策 / 问题 Schema + 执行结果 Schema + 审查结论 Schema），可被 frontmatter 解析（TASK-010）、全局文档读写（TASK-012）、SQLite 索引（TASK-014）、状态机（TASK-007）、状态映射（TASK-008）复用：\n  - 领域原语：src/core/enums.ts 的全部领域枚举 + Zod schema。\n  - 任务 frontmatter：TaskFrontmatterSchema / ContextPackSchema / WorkflowOutputsSchema。\n  - 决策 / 问题：DecisionSchema（§6.6 决策 8 字段）/ IssueSchema（§6.7 问题 8 字段）。\n  - 执行结果：ResultFrontmatterSchema（§10）+ ProgressUpdateRequestSchema / GlobalUpdateRequestsSchema / ResultVerificationSchema / ExecutionCommitSchema / VerificationResultSchema。\n  - 审查结论：ReviewFrontmatterSchema（§15 .review.md frontmatter），字段 task_id / review_result / reviewer / reviewed_at / required_changes / findings。\n- 工具链就绪：npm run typecheck / npm test / npm run lint / npm run build 均可执行且全绿（160 项单测）。\n- 仍无 CLI 命令、状态机、领域规则、infra 适配实现。"
    - section: "当前架构状态"
      mode: append
      content: "src/core/schemas/review-schema.ts 建立：仅依赖 zod 与 ../enums.js，零反向依赖。沿用 TASK-002~005「Zod schema 单一来源 + z.infer 派生类型」模式，ReviewResultSchema / TaskIdSchema 一律复用 enums.ts，不重复声明。reviewed_at 用 z.string().datetime()（ISO8601 UTC，§8）。src/core/index.ts 继续以 export * 聚合新增 Schema，Core type 层（enums + task / decision-issue / result / review 四份 Schema）全部完成。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "后续任务从 src/core 导入 ReviewFrontmatterSchema 复用，勿另起 .review.md 结构定义。关键设计：（1）review_result 复用 enums.ts 的 ReviewResultSchema（approved / rejected / needs-human-confirmation / skipped），skipped 专用于 no_review: true 时 Orchestrator 生成的占位审查（§15），Reviewer 不介入；审查结论到任务状态的映射（approved→done / rejected→rejected / needs-human-confirmation→blocked）由 TASK-008 状态映射评审分支承载，TASK-017 编排实现，本 Schema 只校验枚举取值。（2）reviewed_at 用 z.string().datetime() 默认 offset=false，只接受带 Z 的 UTC 时间戳（§15 示例即为 UTC）；若未来需接受本地时区偏移（+08:00），由对应任务改为 .datetime({ offset: true })。（3）required_changes / findings 为字符串数组，§12 软约束「approved / skipped 时 required_changes 应为空」不在 Schema 硬拒、保留弹性，合法性归 TASK-017 上层编排约束。"
    - section: "当前未解决问题摘要"
      mode: replace
      content: "ISS-004（low，open）：VerificationResultSchema（passed/failed/skipped）因 enums.ts 在 TASK-005 forbidden_paths 而暂置于 result-schema.ts；当前仅服务于 .result.md 上下文，不阻塞，后续若被其他层复用建议提升至 enums.ts。本任务（TASK-006）无新 issue：ReviewResultSchema / TaskIdSchema 已在 enums.ts 定义且可直接 import 复用，无需就近定义。ISS-001/002/003 仍为已解决态。"
    - section: "建议下一个任务"
      mode: replace
      content: "TASK-007：Core 任务状态机（layer: domain，depends_on: TASK-002 已完成）。实现任务状态机合法流转（Readme.md §7 9 态），复用 enums.ts 的 TaskStatusSchema，沿用「Zod schema 单一来源 + z.infer 派生 + 复用 enums」模式。type 层（TASK-002~006）已全部完成，下一阶段进入 domain 层。"
  decisions: []
  issues: []
next_action: review
---

# TASK-006 执行结果

## 1. 执行结论

任务完成。在 `src/core/schemas/review-schema.ts` 定义了 `ReviewFrontmatterSchema`（§15 `.review.md` frontmatter 全部机器字段），枚举字段全部复用 `enums.ts`（`ReviewResultSchema / TaskIdSchema`），TS 类型由 `z.infer` 派生；`src/core/index.ts` 追加 `export * from './schemas/review-schema.js'`；`test/core/schemas/review-schema.test.ts` 20 项用例覆盖正例 / 缺必填 / 枚举非法 / 日期非法 / 软约束不硬拒。typecheck / test / lint 三项全绿，全量 160 用例无回归。

## 2. 完成内容

- `ReviewFrontmatterSchema`：覆盖 §15 模板全部机器字段。
  - `task_id`：复用 `TaskIdSchema`（`TASK-\d+`）。
  - `review_result`：复用 `ReviewResultSchema`（approved / rejected / needs-human-confirmation / skipped）。
  - `reviewer`：`z.string().min(1)`，审查者标识（如 `reviewer-agent` / `orchestrator`）。
  - `reviewed_at`：`z.string().datetime()`（ISO8601 UTC，§8）。
  - `required_changes`：`z.array(z.string())`，必须修改项。
  - `findings`：`z.array(z.string())`，审查发现清单。
- 单测 20 用例：§15 正例（approved 空数组）、required_changes / findings 各带多条字符串、review_result 全枚举取值、skipped 占位审查（Orchestrator 生成）、task_id 开放集合、reviewed_at 含 / 不含毫秒；**§12 软约束：approved + 非空 required_changes、skipped + 非空 required_changes Schema 层仍通过**（验证不硬拒，§12）；缺 6 个必填字段各拒；非法 review_result / 非法 reviewed_at（仅日期 / 斜杠 / 空格 / 无 Z / 无分隔符）各拒；task_id 非法、reviewer 空串、required_changes / findings 类型错误各拒。

## 3. 修改文件

- `src/core/index.ts` —— 追加 `export * from './schemas/review-schema.js'`；既有 enums / task-schema / decision-issue-schema / result-schema 导出与架构约束注释不变。

## 4. 新增文件

- `src/core/schemas/review-schema.ts` —— 审查结论 frontmatter Schema 集中定义。
- `test/core/schemas/review-schema.test.ts` —— 校验单测（20 用例）。

## 5. 删除文件

暂无。

## 6. 架构决策

本任务无新决策争议，沿用既有「Zod schema 单一来源 + `z.infer` 派生类型 + 复用 enums」模式（TASK-002~005 已确立）。三处设计直接落地规格、无张力：

- `review_result` 复用 `enums.ts` 的 `ReviewResultSchema`——§15 明文取值，且 `enums.ts` 已定义，无需就近声明。
- `reviewed_at` 用 `z.string().datetime()`——任务 §8 明文推荐，§15 示例即为 UTC。
- `required_changes` / `findings` 为字符串数组——§15 模板只给出 `[]` 占位、未暗示对象结构，取最小结构。

§12 软约束「approved / skipped 时 required_changes 应为空不硬拒」是任务 §12 明文要求，非争议。

故 `global_update_requests.decisions` 为空。

## 7. 偏离计划

无。实现严格落在任务 §2 目标字段集与 §11 验收标准内：未提前实现审查结论到任务状态映射（属 TASK-008 评审分支，由 TASK-017 编排）、未实现 `.review.md` 读写（TASK-011）。`ReviewResultSchema` / `TaskIdSchema` 复用而非重声明，是单一来源原则的贯彻，非偏离。

## 8. 后续任务注意事项

- 状态映射评审分支（TASK-008 / TASK-017）：据 `review_result` 映射任务状态（approved→done / rejected→rejected / needs-human-confirmation→blocked / skipped→免审直入 done 但须校验 .result.md 与全局更新建议齐全，§15），Schema 层已明确不约束组合。
- `.review.md` 读写（TASK-011）：frontmatter 解析后直接 `ReviewFrontmatterSchema.safeParse`。
- `reviewed_at` 时区弹性：当前 `.datetime()` 默认只接受 UTC（Z）。若未来 Reviewer 写本地时区偏移（如 `+08:00`）需被接受，由对应任务改为 `.datetime({ offset: true })`；§15 示例为 UTC，当前默认行为符合规格。
- `required_changes` / `findings` 元素结构：当前为字符串数组（§15 模板未规定元素内部结构）。若后续审查发现清单需要结构化（如带严重程度 / 位置 / 描述的对象），由对应任务扩展子 Schema。
- domain 层任务（TASK-007 起）在 `src/core/` 下新增文件（state-machine.ts / rules/）并在 `index.ts` 追加 `export *`。

## 9. 未解决问题

本任务无开放 issue。`ReviewResultSchema` / `TaskIdSchema` 已在 `enums.ts` 定义且可直接 import 复用，无就近定义枚举的需要（区别于 TASK-005 的 `VerificationResultSchema`，那是 `enums.ts` 在其 forbidden 且该枚举尚不存在所致）。既有 ISS-004（low，open）仍仅服务于 `.result.md` 上下文，不阻塞；ISS-001/002/003 仍为已解决态。

## 10. 验证结果

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run typecheck` | passed | `tsc --noEmit` 0 错误 |
| `npm test -- core/schemas/review-schema` | passed | vitest 1 文件 20 用例全通过 |
| `npm run lint` | passed | ESLint src/test 无 error/warning |
| `npm test`（全量） | passed | 5 文件 160 用例全通过，既有四组 Schema 无回归 |

## 11. 人工验收建议

- 复核 `ReviewFrontmatterSchema` 字段集是否与 Readme §15 frontmatter 模板逐字对齐（`task_id / review_result / reviewer / reviewed_at / required_changes / findings`）。
- 复核 §11 验收：非法 `review_result` 被拒、`reviewed_at` 非法日期被拒（均有用例）。
- 复核 §12 软约束设计：确认 approved + 非空 required_changes 在 Schema 层通过、留待 TASK-017 上层编排约束是否符合预期（任务 §12）。
- 复核 `reviewed_at` 用 `.datetime()` 默认只接受 UTC 是否符合预期（§15 示例为 UTC；如需接受时区偏移需后续扩 `{ offset: true }`）。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（6 个 section 更新建议）、decisions（空，无新决策）、issues（空，无新问题）。由 Orchestrator 在合并回 main 后统一回写 `docs/PROGRESS.md`（`docs/DECISIONS.md` / `docs/ISSUES.md` 本任务无新增）。按本项目惯例，第 5 步已直接回写。
