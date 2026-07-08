---
task_id: TASK-004
execution_status: completed
modified_files:
  - src/core/index.ts
created_files:
  - src/core/schemas/decision-issue-schema.ts
  - test/core/schemas/decision-issue-schema.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "tsc --noEmit，0 错误（strict + noUncheckedIndexedAccess）"
  - command: npm test -- core/schemas/decision-issue-schema
    result: passed
    notes: "vitest run，1 文件 40 用例全部通过"
  - command: npm run lint
    result: passed
    notes: "eslint src test，无 error / warning"
  - command: npm test
    result: passed
    notes: "全量 3 文件 94 用例（enums 26 + task-schema 28 + decision-issue-schema 40）全通过，无回归"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: replace
      content: "TASK-004（Core 决策与问题机器字段 Schema）已完成：在 src/core/schemas/decision-issue-schema.ts 定义 DecisionSchema 与 IssueSchema，复用 enums.ts 的 DecisionStatusSchema / IssueStatusSchema / IssueSeveritySchema / ScopeSchema，配套 40 项单测；src/core/index.ts 追加再导出。"
    - section: "当前系统可用能力"
      mode: replace
      content: "Core 决策 / 问题 Schema 就绪：DecisionSchema / IssueSchema 可被 .result.md 的 global_update_requests 校验（TASK-005）、全局文档读写（TASK-012）、SQLite 索引（TASK-014）复用。Core 三层 type 资产齐备（枚举 + 任务 Schema + 决策 / 问题 Schema）。工具链 npm run typecheck / npm test / npm run lint 全绿。仍无 CLI / 状态机 / 规则 / infra 实现。"
    - section: "当前架构状态"
      mode: append
      content: "src/core/schemas/decision-issue-schema.ts 建立：仅依赖 zod 与 ../enums.js，零反向依赖。沿用 TASK-002 / TASK-003「Zod schema 单一来源 + z.infer 派生类型」模式，枚举一律复用 enums.ts，不重复声明。src/core/index.ts 继续以 export * 聚合新增 Schema。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "后续 Result Schema（TASK-005）从 src/core 导入 DecisionSchema / IssueSchema 组装 global_update_requests.decisions / issues 容器，勿另起结构定义。DecisionSchema 必填 8 字段（id / title / status / scope / created_from_task / decision / rationale / consequences），IssueSchema 必填 8 字段（id / title / status / severity / scope / created_from_task / owner / recommended_action），缺失即拒。id 允许空串（提议态），DEC-XXX / ISS-XXX 格式校验是 application 层 id 分配职责（TASK-020），不在 Schema 内。created_from_task 复用 ScopeSchema（SPEC / ARCHITECTURE / TASK-\\d+）；scope 当前为自由文本（非空），与任务 §8 字面「用枚举」存在张力，见 ISSUES。"
    - section: "当前未解决问题摘要"
      mode: replace
      content: "1) Readme.md 未显式枚举 DecisionStatus / IssueStatus / IssueSeverity 完整取值（TASK-002 遗留，low / open，影响面已由 enums.ts 最小推断集覆盖，本任务复用）；2) scope 字段语义张力：任务 §8「status/scope/severity 用枚举」与 enums.ts ScopeSchema 注释「校验 created_from_task / scope 字段」倾向于 scope 为枚举，但 §6.6「影响范围」语义、§10 正例 scope: state / scope: api、TASK-003 已提交 result.md 的 scope: core 均为自由文本，本任务按自由文本落地，待 Orchestrator 确认统一方向（见 ISSUES）；3) 任务文件 id 正则精度不一致（TASK-003 遗留 \\d{3,} vs \\d+，未阻塞，继承可见）。"
    - section: "建议下一个任务"
      mode: replace
      content: "TASK-005：Core 执行结果 Schema（layer: type，depends_on: TASK-003）。复用本任务的 DecisionSchema / IssueSchema 组装 global_update_requests 容器，并定义 .result.md frontmatter 整体 Schema（含 execution_status / next_action / verification 对象数组 / modified_files 等）。"
  decisions:
    - id: ""
      title: "决策 / 问题 Schema 的 scope 取自由文本，created_from_task 取 ScopeSchema"
      status: proposed
      scope: core
      decision: "DecisionSchema / IssueSchema 的 created_from_task 字段复用 enums.ts 的 ScopeSchema（SPEC | ARCHITECTURE | TASK-\\d+）；scope 字段取自由文本（z.string().min(1)），不套枚举。"
      rationale: "§6.6 / §6.7 把 scope 释义为「影响范围」，§10 模板正例用 scope: state / scope: api，TASK-003 已提交的 result.md 提议项用 scope: core，均为模块 / 层级自由文本，无法穷举为枚举。本 Schema 将同时校验 .result.md 的 global_update_requests 提议项（§9 数据流），若 scope 套 ScopeSchema 会直接拒绝项目自身已提交的产物与规格正例。created_from_task 语义明确（来源任务 / 阶段），可枚举，故复用 ScopeSchema。"
      consequences: "本决策与任务 §8 字面「status/scope/severity 用枚举」、enums.ts ScopeSchema 注释「校验 created_from_task / scope 字段」存在偏差：实际仅 created_from_task 用枚举，scope 用自由文本。偏差已作为 issue 上报待 Orchestrator 确认。若确认收紧 scope 为枚举，需另开任务改本 Schema 并修正 §10 示例与 TASK-003 result.md 的 scope 值（在 forbidden，需扩权）。"
      created_from_task: TASK-004
  issues:
    - id: ""
      title: "scope 字段语义张力：任务 §8「用枚举」 vs §6.6/§10/TASK-003 的自由文本实际用法"
      status: open
      severity: medium
      scope: core
      owner: ""
      recommended_action: "由 Orchestrator 确认统一方向后回写：方案 A（确认自由文本，推荐）——回写 TASK-004 §8 去掉 scope 的「用枚举」措辞、修正 enums.ts ScopeSchema 注释为仅 created_from_task，本实现无需改动；方案 B（收紧为枚举）——需为 scope 选定枚举（如 LayerSchema 或新增），改本 Schema，并修正 §10 示例 scope: state/api 与 TASK-003 result.md scope: core（后者在 forbidden_paths，需扩权新任务）。本任务已按方案 A 落地，不阻塞 TASK-004 验收（§6.6/§6.7 正例通过、缺必填被拒、id 空合法、created_from_task 三态通过）。"
      created_from_task: TASK-004
next_action: review
---

# TASK-004 执行结果

## 1. 执行结论

任务完成。在 `src/core/schemas/decision-issue-schema.ts` 定义了 `DecisionSchema`（§6.6 决策 8 字段）与 `IssueSchema`（§6.7 问题 8 字段），枚举字段全部复用 `enums.ts` 的 `DecisionStatusSchema / IssueStatusSchema / IssueSeveritySchema / ScopeSchema`，TS 类型由 `z.infer` 派生；`src/core/index.ts` 追加 `export * from './schemas/decision-issue-schema.js'`；`test/core/schemas/decision-issue-schema.test.ts` 40 项用例覆盖正例 / 缺必填 / 类型与枚举非法。typecheck / test / lint 三项全绿，全量 94 用例无回归。

## 2. 完成内容

- `DecisionSchema`：必填 `id / title / status / scope / created_from_task / decision / rationale / consequences`（缺失即拒）。
  - `id`：`z.string()`，允许空串（提议态留空，由 Orchestrator 分配 `DEC-XXX`），不写格式正则（§12：id 分配是 application 层职责）。
  - `status`：复用 `DecisionStatusSchema`（proposed / accepted / superseded）。
  - `created_from_task`：复用 `ScopeSchema`（SPEC / ARCHITECTURE / TASK-\d+）。
  - `scope`：自由文本非空（影响范围，见第 6 节决策与第 9 节 issue）。
- `IssueSchema`：必填 `id / title / status / severity / scope / created_from_task / owner / recommended_action`（缺失即拒）。
  - `status` 复用 `IssueStatusSchema`；`severity` 复用 `IssueSeveritySchema`；`created_from_task` 复用 `ScopeSchema`。
  - `owner`：`z.string()`，允许空串（§10 示例与 TASK-003 提议项均 `owner: ""`，表达尚未指派）。
- 单测 40 用例：两个 Schema 各自正例（模板形态 / id 分配后 / 全枚举取值 / created_from_task 三态 / scope 自由文本）、缺 8 个必填字段各拒、status / severity / created_from_task 非法各拒、文本字段空串与类型错误各拒、owner 空串合法但非字符串被拒。

## 3. 修改文件

- `src/core/index.ts` —— 追加 `export * from './schemas/decision-issue-schema.js'`；既有 enums / task-schema 导出与架构约束注释不变。

## 4. 新增文件

- `src/core/schemas/decision-issue-schema.ts` —— 决策与问题机器字段 Schema 集中定义。
- `test/core/schemas/decision-issue-schema.test.ts` —— 校验单测（40 用例）。

## 5. 删除文件

暂无。

## 6. 架构决策

见 frontmatter `global_update_requests.decisions`：决策 / 问题 Schema 的 `scope` 取自由文本（`z.string().min(1)`），`created_from_task` 取 `ScopeSchema`。两者语义不同——scope 是「影响范围」（模块 / 层级自由文本），created_from_task 是「来源任务 / 阶段」（可枚举）。该决策为 Task Executor 提议（status: proposed），与任务 §8 字面的偏差见第 9 节 issue。

## 7. 偏离计划

一处刻意偏离：任务 §8 字面要求 `status/scope/severity` 均用枚举，但本任务把 `scope` 实现为自由文本而非枚举。原因：§6.6 / §6.7 把 scope 释义为「影响范围」，§10 模板正例用 `scope: state` / `scope: api`，TASK-003 已提交的 result.md 提议项用 `scope: core`——这些都是无法穷举的模块 / 层级自由文本；而本 Schema 将来要校验 `.result.md` 的 `global_update_requests` 提议项（§9 数据流），若 scope 套 `ScopeSchema` 会直接拒绝项目自身已提交的产物与规格正例。经用户在编码前确认同意（按自由文本方案），偏差透明记录于决策与 issue，未自行越界修改 `enums.ts`（在 forbidden）或任务文件。`status / severity` 仍严格用枚举，符合 §8 的核心校验意图。

## 8. 后续任务注意事项

- Result Schema（TASK-005）：从 `src/core` 导入 `DecisionSchema / IssueSchema` 组装 `global_update_requests.decisions / issues` 数组容器，避免重复定义字段。
- 全局文档读写（TASK-012）：解析 `DECISIONS.md` / `ISSUES.md` 的 frontmatter / fenced YAML 后直接 `DecisionSchema.safeParse` / `IssueSchema.safeParse`。
- SQLite 索引（TASK-014）：可消费 `id / status / scope / created_from_task / severity`（issue）。
- id 分配（TASK-020）：`DEC-XXX` / `ISS-XXX` 格式校验在那里做，不在本 Schema；本 Schema 的 `id` 仅约束为字符串（允许空）。
- 后续 type 层 Schema（TASK-005 / TASK-006）在 `src/core/schemas/` 下新增文件并在 `index.ts` 追加 `export *`。

## 9. 未解决问题

见 frontmatter `global_update_requests.issues`：`scope` 字段语义张力——任务 §8「status/scope/severity 用枚举」与 `enums.ts` 的 `ScopeSchema` 注释「校验 created_from_task / scope 字段」倾向于 scope 为枚举，但 §6.6 / §10 正例与 TASK-003 已提交产物均为自由文本。本任务按自由文本落地（方案 A），待 Orchestrator 确认统一方向；若选收紧（方案 B），需另开任务改本 Schema 并修正 §10 示例与 TASK-003 result.md 的 scope 值（后者在 forbidden，需扩权）。另继承 TASK-002 / TASK-003 两项遗留（枚举取值待 Readme 确认、任务 id 正则精度不一致），未阻塞本任务，仅保留可见性。

## 10. 验证结果

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run typecheck` | passed | `tsc --noEmit` 0 错误 |
| `npm test -- core/schemas/decision-issue-schema` | passed | vitest 1 文件 40 用例全通过 |
| `npm run lint` | passed | ESLint src/test 无 error/warning |
| `npm test`（全量） | passed | 3 文件 94 用例全通过，enums / task-schema 无回归 |

## 11. 人工验收建议

- 复核 `DecisionSchema` / `IssueSchema` 字段集是否与 Readme §6.6 / §6.7「至少包括」逐字对齐（8 + 8 字段）。
- 复核 `scope` 取自由文本的决策（见第 6 / 9 节），确认统一方向：维持自由文本（方案 A）还是收紧为枚举（方案 B）。
- 复核 `id` 仅约束为字符串、不写 `DEC-XXX` / `ISS-XXX` 格式正则是否符合预期（id 分配归 TASK-020）。
- 复核 `owner` 允许空串、其余文本字段要求非空是否合理。
- 复核 `created_from_task` 复用 `ScopeSchema` 是否覆盖所有合法来源（SPEC / ARCHITECTURE / TASK-\d+）。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（6 个 section 更新建议）、decisions（1 条 proposed：scope 自由文本 + created_from_task 用 ScopeSchema）、issues（1 条 open/medium：scope 语义张力）。由 Orchestrator 在合并回 main 后统一回写 `docs/PROGRESS.md` / `docs/DECISIONS.md` / `docs/ISSUES.md`。
