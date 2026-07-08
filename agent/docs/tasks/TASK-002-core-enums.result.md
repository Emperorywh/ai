---
task_id: TASK-002
execution_status: completed
modified_files:
  - src/core/index.ts
created_files:
  - src/core/enums.ts
  - test/core/enums.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "tsc --noEmit，0 错误（strict + noUncheckedIndexedAccess）"
  - command: npm test -- core/enums
    result: passed
    notes: "vitest run core/enums，1 文件 26 用例全部通过"
  - command: npm run lint
    result: passed
    notes: "eslint src test，无 error / warning"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: replace
      content: "TASK-002（Core 领域原语与枚举）已完成：在 src/core/enums.ts 定义全部领域枚举（Layer / Permission / TaskStatus / ExecutionStatus / NextAction / ReviewResult / ProgressMode / Scope，以及 Scope 的构件 ScopeStage / TaskId 与 TASK_ID_PATTERN），配套 Zod schema 与 26 项单测。"
    - section: "当前系统可用能力"
      mode: replace
      content: "Core 领域原语就绪：全部领域枚举 + Zod schema 可被后续 Schema（TASK-003…006）与规则（TASK-007…009）直接复用。工具链 npm run typecheck / npm test / npm run lint 全绿。仍无 CLI / 状态机 / 规则实现。"
    - section: "当前架构状态"
      mode: append
      content: "src/core/enums.ts 仅依赖 zod，零反向依赖；src/core/index.ts 经 ./enums.js 再导出（NodeNext 需 .js 后缀）。枚举统一采用「Zod schema 为单一来源 + z.infer 派生 TS 类型 + .options 提供值数组」模式，杜绝类型标注与校验规则漂移。Scope 以异构联合（ScopeStage ∪ TaskId 正则）表达 SPEC/ARCHITECTURE 与任意 TASK-XXX 同为合法值。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "后续 Schema 任务（TASK-003…006）从 src/core 导入各 XxxSchema 复用，勿另起取值定义；created_from_task / 来源类字段用 ScopeSchema 校验。DecisionStatus / IssueStatus / IssueSeverity 当前为基于 Readme §10 示例 + 工作流语义的最小推断集，Readme 未显式枚举完整取值，见 ISSUES，TASK-004 落地前需 Orchestrator 确认。"
    - section: "当前未解决问题摘要"
      mode: replace
      content: "Readme.md 未显式枚举 DecisionStatus / IssueStatus / IssueSeverity 的完整取值，TASK-002 已给出最小推断集并标注，需 Orchestrator 在 Readme/文档中确认（详见 ISSUES 与本 .result.md 第 9 节）。"
    - section: "建议下一个任务"
      mode: replace
      content: "TASK-003：Core 任务 frontmatter Schema（layer: type，depends_on: TASK-002）。"
  decisions:
    - id: ""
      title: "core 枚举采用 Zod schema 单一来源模式"
      status: proposed
      scope: core
      decision: "所有领域枚举在 src/core/enums.ts 中以 z.enum（或 z.union）定义为唯一来源，TS 联合类型由 z.infer 派生，遍历用 XxxSchema.options；禁止另立与 schema 不同源的常量数组或手写联合类型。"
      rationale: "避免「TS 类型标注」与「Zod 运行时校验」两套取值各自维护导致漂移；Zod schema 同时是 frontmatter/文档校验与 SQLite 索引的输入，单一来源最符合长期架构正确性。"
      consequences: "后续 TASK-003…009 必须复用本文件 schema，不得重复声明枚举取值；新增枚举时遵循同模式。开放集合（如 TaskId）类型退化为 string，运行时由 schema 兜底校验。"
      created_from_task: TASK-002
  issues:
    - id: ""
      title: "Readme.md 未显式枚举 DecisionStatus / IssueStatus / IssueSeverity 完整取值"
      status: open
      severity: medium
      scope: core
      owner: ""
      recommended_action: "由 Orchestrator 在 Readme.md（§6.6/§6.7）或文档中确认这三个字段的权威取值集合后回写，TASK-004（决策与问题 Schema）再据此落地 Zod 校验。TASK-002 当前给出的最小推断集——DecisionStatus: proposed|accepted|superseded；IssueStatus: open|resolved；IssueSeverity: low|medium|high|critical——仅以 Readme §10 示例值（accepted/open/high）锚定，其余基于工作流语义推断，未确认前不应视为最终事实来源。"
      created_from_task: TASK-002
next_action: review
---

# TASK-002 执行结果

## 1. 执行结论

任务完成。在 `src/core/enums.ts` 定义了全部 11 个领域枚举（含 Scope 的构件 ScopeStage / TaskId 与 `TASK_ID_PATTERN`），每个枚举同时导出 Zod schema 与由 `z.infer` 派生的 TS 联合类型；`src/core/index.ts` 经 `./enums.js` 再导出；`test/core/enums.test.ts` 26 项用例覆盖合法值通过 / 非法值拒绝。typecheck / test / lint 三项验证全绿。

## 2. 完成内容

- 定义 `Layer`(7) / `Permission`(9) / `TaskStatus`(9) / `ExecutionStatus`(3) / `NextAction`(4) / `ReviewResult`(4) / `ProgressMode`(2) 共 7 个有 Readme 权威取值的封闭枚举，取值与 Readme §7/§9/§10/§15/§16 逐一对应。
- 定义 `Scope` 异构联合（`ScopeStage` ∪ `TaskId` 正则），覆盖 `SPEC` / `ARCHITECTURE` 与任意 `TASK-XXX`（Readme §6.6/§6.7）。
- 定义 `DecisionStatus` / `IssueStatus` / `IssueSeverity` 三个 Readme 未完整枚举的字段，给出基于 §10 示例 + 工作流语义的最小推断集，并在代码注释显著标注待确认。
- 单测：7 个权威枚举断言声明值数量 + 非法值拒绝；Scope/ScopeStage/TaskId 覆盖异构联合各类边界；3 个推断枚举只验契约（声明值通过 + 非法拒绝），不写死数量。

## 3. 修改文件

- `src/core/index.ts` —— 将 `export {}` 改为 `export * from './enums.js'`，并加一行 TASK-002 说明注释；头部架构约束注释保持不变。

## 4. 新增文件

- `src/core/enums.ts` —— 全部领域枚举 + Zod schema 集中定义。
- `test/core/enums.test.ts` —— 枚举 Zod 校验单测（26 用例）。

## 5. 删除文件

暂无。

## 6. 架构决策

见 frontmatter `global_update_requests.decisions`：core 枚举采用「Zod schema 单一来源 + z.infer 派生类型」模式，杜绝类型与校验漂移。该决策为 Task Executor 提议（status: proposed），待 Orchestrator 回写确认。

## 7. 偏离计划

无偏离。任务 §2 列出的 11 个枚举全部定义；唯一与「理想 source_spec 驱动」的差距是 `DecisionStatus` / `IssueStatus` / `IssueSeverity` 三者取值在 Readme 中缺失（见第 9 节），已按任务 §11 验收标准（该三类不在「逐一对应」清单内）以最小推断集落地并透明标注，未自行越界修改 Readme 或任务范围。

## 8. 后续任务注意事项

- TASK-003（任务 frontmatter Schema）起，所有复合 Schema 从 `src/core` 导入 `LayerSchema` / `TaskStatusSchema` / `PermissionSchema` 等复用，**禁止重复声明枚举取值**。
- `ScopeSchema` 用于校验决策 / 问题的 `created_from_task`（与任何「阶段标识 ∪ 任务 id」语义字段）；注意 Readme 中独立的 `scope`（影响范围）字段是自由文本（§10 示例 state/api），与 `ScopeSchema` 不是同一约束，TASK-004 落地时需区分，勿混淆。
- `TaskId` 是开放集合，TS 类型退化为 `string`，运行时由 `TaskIdSchema` 兜底；上层做语义标注时可使用该类型。

## 9. 未解决问题

见 frontmatter `global_update_requests.issues`：Readme.md 未显式枚举 `DecisionStatus` / `IssueStatus` / `IssueSeverity` 的完整取值。当前推断集：

- `DecisionStatus`: `proposed` | `accepted` | `superseded`
- `IssueStatus`: `open` | `resolved`
- `IssueSeverity`: `low` | `medium` | `high` | `critical`

仅 `accepted` / `open` / `high` 来自 Readme §10 示例，其余为工作流语义推断。需 Orchestrator 在 Readme/文档确认后再由 TASK-004 落地最终校验。不阻塞 TASK-002（验收 §11 不要求该三类与 Readme 逐一对应），但会影响 TASK-004，故 severity 定为 medium、status: open。

## 10. 验证结果

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run typecheck` | passed | `tsc --noEmit` 0 错误 |
| `npm test -- core/enums` | passed | vitest 1 文件 26 用例全通过 |
| `npm run lint` | passed | ESLint src/test 无 error/warning |

## 11. 人工验收建议

- 复核 7 个权威枚举取值是否与 Readme §7/§9/§10/§15/§16 完全一致（重点：`state` layer 在本项目未启用但按 Readme §9 保留；`ReviewResult` 含 `skipped` 对应 no_review 场景）。
- 复核 3 个推断枚举（DecisionStatus/IssueStatus/IssueSeverity）的取值是否可接受为暂定集，或需在 Readme 补全后再让 TASK-004 落地。
- 确认 `ScopeSchema` 校验对象（`created_from_task`）与 Readme 自由文本 `scope`（影响范围）字段的区分是否与本仓库后续 Schema 设计一致。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（6 个 section 更新建议，覆盖完成进度 / 能力 / 架构 / 后续须知 / 未解决问题 / 下一任务）、decisions（1 条 proposed：枚举单一来源模式）、issues（1 条 open/medium：3 个枚举取值 source_spec 缺口）。由 Orchestrator 在合并回 main 后统一回写 `docs/PROGRESS.md` / `docs/DECISIONS.md` / `docs/ISSUES.md`。
