---
task_id: TASK-003
execution_status: completed
modified_files:
  - src/core/index.ts
created_files:
  - src/core/schemas/task-schema.ts
  - test/core/schemas/task-schema.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "tsc --noEmit，0 错误（strict + noUncheckedIndexedAccess）"
  - command: npm test -- core/schemas/task-schema
    result: passed
    notes: "vitest run core/schemas/task-schema，1 文件 28 用例全部通过；全量 npm test 54 用例（enums 26 + task-schema 28）无回归"
  - command: npm run lint
    result: passed
    notes: "eslint src test，无 error / warning"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: replace
      content: "TASK-003（Core 任务 frontmatter Schema）已完成：在 src/core/schemas/task-schema.ts 定义 TaskFrontmatterSchema 与配套 ContextPackSchema / WorkflowOutputsSchema，复用 enums.ts 的 Layer / TaskStatus / Permission / TaskId schema，配套 28 项单测；src/core/index.ts 追加再导出。"
    - section: "当前系统可用能力"
      mode: replace
      content: "Core 任务 frontmatter Schema 就绪：TaskFrontmatterSchema / ContextPackSchema / WorkflowOutputsSchema 可被 frontmatter 解析器（TASK-010）、SQLite 索引（TASK-014）复用；status 字段可被状态机（TASK-007）消费。Core 领域原语（枚举）+ 任务 Schema 两层 type 资产齐备。工具链 npm run typecheck / npm test / npm run lint 全绿。仍无 CLI / 状态机 / 规则 / infra 实现。"
    - section: "当前架构状态"
      mode: append
      content: "src/core/schemas/ 目录建立：task-schema.ts 仅依赖 zod 与 ../enums.js，零反向依赖。复合 Schema 沿用 TASK-002「Zod schema 单一来源 + z.infer 派生类型」模式，枚举与 id 正则一律复用 enums.ts，不重复声明。src/core/index.ts 以 export * 聚合 enums 与 schemas/task-schema，后续 Schema 文件在此继续追加导出。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "后续 frontmatter / 索引 / 解析任务从 src/core 导入 TaskFrontmatterSchema / ContextPackSchema / WorkflowOutputsSchema 复用，勿另起结构定义。必填字段集为 id / title / status / layer / allowed_paths / verification / context_pack / workflow_outputs；depends_on / forbidden_paths / permissions / no_review / restart_on_retry 缺失取默认（[] / false）。任务文件模板的 verification 是字符串数组，与 .result.md 的对象数组形态（§10）不是同一结构，切勿混用。id 字段当前复用 enums.ts 的 TaskIdSchema（/^TASK-\\d+$/），与任务 §8 字面的 /^TASK-\\d{3,}$/ 存在精度差异，见 ISSUES。"
    - section: "当前未解决问题摘要"
      mode: replace
      content: "1) Readme.md 未显式枚举 DecisionStatus / IssueStatus / IssueSeverity 完整取值（TASK-002 遗留，medium / open，影响 TASK-004）；2) 任务文件 id 正则精度不一致：TASK-003 §8 写 ^TASK-\\d{3,}$，enums.ts 的 TaskIdSchema 为 ^TASK-\\d+$，本任务按单一来源复用后者，差异待 Orchestrator 确认统一方向（见 ISSUES）。"
    - section: "建议下一个任务"
      mode: replace
      content: "TASK-004：Core 决策与问题机器字段 Schema（layer: type，depends_on: TASK-002）。注意其落地受遗留 issue 1) 影响——DecisionStatus / IssueStatus / IssueSeverity 取值需 Orchestrator 先在 Readme/文档确认。"
  decisions:
    - id: ""
      title: "任务 frontmatter 的 id 字段复用 enums.ts 的 TaskIdSchema"
      status: proposed
      scope: core
      decision: "TaskFrontmatterSchema.id 直接复用 src/core/enums.ts 的 TaskIdSchema（/^TASK-\\d+$/），不为本字段另立 ^TASK-\\d{3,}$ 正则。"
      rationale: "AGENTS.md §3「不复制粘贴重复逻辑」与 TASK-002「枚举/schema 单一来源」决策要求 id 校验规则只有一处定义；TaskIdSchema 的 \\d+ 是任务 §8 \\d{3,} 的超集，不拒绝任何真实 3 位任务 id（TASK-001…TASK-029 均通过），§11 正例验收不受影响。id 与 created_from_task 同为「任务 id」语义，同源校验更自洽。"
      consequences: "本决策与任务 §8 字面（\\d{3,}）存在偏差，已作为 issue 上报待 Orchestrator 统一：若确认收紧，应改 enums.ts 的 TaskIdSchema 为 \\d{3,}（届时 TASK-003 id 字段随之收紧，无需改本文件）；若确认放宽，应回写任务 §8 / Readme。后续 Schema 凡涉及任务 id 一律复用 TaskIdSchema。"
      created_from_task: TASK-003
  issues:
    - id: ""
      title: "任务文件 id 正则精度不一致：§8 的 \\d{3,} 与 enums.ts TaskIdSchema 的 \\d+"
      status: open
      severity: medium
      scope: core
      owner: ""
      recommended_action: "由 Orchestrator 确认统一方向后回写：方案 A——把 enums.ts 的 TaskIdSchema 收紧为 /^TASK-\\d{3,}$/（需开新任务改 enums.ts，TASK-003 的 id 字段随之收紧，Scope 联合中的 TaskId 分支同步收紧）；方案 B——把 TASK-003 §8 与 Readme §9 模板说明放宽为 \\d+（接受任意位数）。本任务已按方案 B 的精神（复用 \\d+）落地，等待确认。不阻塞 TASK-003 验收（\\d+ 是超集，所有真实 id 通过），但影响「id 与 created_from_task 是否同精度」的长期一致性。"
      created_from_task: TASK-003
next_action: review
---

# TASK-003 执行结果

## 1. 执行结论

任务完成。在 `src/core/schemas/task-schema.ts` 定义了 `TaskFrontmatterSchema` 及配套 `ContextPackSchema`、`WorkflowOutputsSchema`，全部字段复用 `enums.ts` 的既有 schema（`Layer / TaskStatus / Permission / TaskId`），TS 类型由 `z.infer` 派生；`src/core/index.ts` 追加 `export * from './schemas/task-schema.js'`；`test/core/schemas/task-schema.test.ts` 28 项用例覆盖正例 / 缺必填 / 类型错误 / 非法枚举 / context_pack 结构 / result_file 必填 / 默认值。typecheck / test / lint 三项全绿，全量测试无回归。

## 2. 完成内容

- `ContextPackSchema`：`required_docs / optional_doc_excerpts / source_files` 三字符串数组子字段，均允许空数组（§8 裁剪规则）。
- `WorkflowOutputsSchema`：`result_file` 必填非空（§11）。
- `TaskFrontmatterSchema`：覆盖 §9 模板全部机器字段。
  - 必填：`id / title / status / layer / allowed_paths / verification / context_pack / workflow_outputs`（缺失即拒）。
  - 默认：`depends_on / forbidden_paths / permissions` 默认 `[]`，`no_review / restart_on_retry` 默认 `false`。
  - `id` 复用 `TaskIdSchema`；`status` 接受全部 9 态（不强制初值，任务 §8）；`verification` 为字符串数组（任务 §12 风险点）。
- 单测 28 用例：正例（模板形态 / 默认值 / 空数组 / 全 status / 多依赖）、缺 8 个必填字段各拒、id 非法格式 / 非法枚举 / 类型错误各拒、`ContextPackSchema` 与 `WorkflowOutputsSchema` 独立结构校验。

## 3. 修改文件

- `src/core/index.ts` —— 将 TASK-002 占位注释收敛为单行，追加 `export * from './schemas/task-schema.js'`；头部架构约束注释不变。

## 4. 新增文件

- `src/core/schemas/task-schema.ts` —— 任务 frontmatter 三 schema 集中定义。
- `test/core/schemas/task-schema.test.ts` —— 校验单测（28 用例）。

## 5. 删除文件

暂无。

## 6. 架构决策

见 frontmatter `global_update_requests.decisions`：任务 frontmatter 的 `id` 字段复用 `enums.ts` 的 `TaskIdSchema`（`/^TASK-\d+$/`），不为本字段另立 `^TASK-\d{3,}$`，遵循单一来源。该决策为 Task Executor 提议（status: proposed），偏差与统一方向见第 9 节 issue。

## 7. 偏离计划

一处刻意偏离：任务 §8 字面要求 `id` 用 `^TASK-\d{3,}$`，本任务按「单一来源 / 不重复声明」复用了 `enums.ts` 的 `TaskIdSchema`（`^TASK-\d+$`）。经用户在编码前确认同意（选方案 A：复用），偏差透明记录于决策与 issue，未自行越界修改 `enums.ts`（在 forbidden）或任务文件。其余无偏离。

## 8. 后续任务注意事项

- frontmatter 解析器（TASK-010）：解析出 YAML 对象后直接 `TaskFrontmatterSchema.safeParse`；注意 `.default()` 字段在 parse 后必有值，但 TS 类型上为可选。
- SQLite 索引（TASK-014）：可直接消费 `id / title / status / layer / depends_on / allowed_paths / permissions`。
- 状态机（TASK-007）：`status` 字段取值范围与 `TaskStatusSchema` 完全一致。
- 后续 type 层 Schema（TASK-004…006）在 `src/core/schemas/` 下新增文件，并在 `index.ts` 追加 `export *`。
- `verification` 字段两套形态不要混：任务文件 = `string[]`，`.result.md` = `{command,result,notes}[]`。

## 9. 未解决问题

见 frontmatter `global_update_requests.issues`：任务文件 `id` 正则精度不一致（§8 `\d{3,}` vs enums.ts `\d+`），本任务按复用 `\d+` 落地，待 Orchestrator 确认统一方向。另继承 TASK-002 遗留：`DecisionStatus / IssueStatus / IssueSeverity` 取值待确认（影响 TASK-004），未在本任务重复登记 issue，仅在 progress 摘要中保留可见性。

## 10. 验证结果

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run typecheck` | passed | `tsc --noEmit` 0 错误 |
| `npm test -- core/schemas/task-schema` | passed | vitest 1 文件 28 用例全通过 |
| `npm test`（全量） | passed | 2 文件 54 用例全通过，enums 无回归 |
| `npm run lint` | passed | ESLint src/test 无 error/warning |

## 11. 人工验收建议

- 复核 `TaskFrontmatterSchema` 字段集是否与 Readme §9 模板逐字段一致（重点：`no_review / restart_on_retry / context_pack / workflow_outputs` 是否齐备）。
- 复核「必填 vs 默认」划分是否符合预期：当前 `depends_on / forbidden_paths / permissions / no_review / restart_on_retry` 缺失取默认，是否应改为强制必填。
- 复核 `id` 复用 `TaskIdSchema`（`\d+`）的决策，确认统一方向（见第 9 节）。
- 复核 `result_file` 仅校验非空、未加路径正则是否可接受。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（6 个 section 更新建议）、decisions（1 条 proposed：id 复用 TaskIdSchema）、issues（1 条 open/medium：id 正则精度差异）。由 Orchestrator 在合并回 main 后统一回写 `docs/PROGRESS.md` / `docs/DECISIONS.md` / `docs/ISSUES.md`。
