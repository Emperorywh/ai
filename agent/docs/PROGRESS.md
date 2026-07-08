---
doc: PROGRESS
status: active
---

# PROGRESS — 当前项目状态

> 本文件只保留当前有效状态，用于上下文恢复（见 `Readme.md` §6.5）。完整历史记录在各 `TASK-XXX.result.md` 与 `docs/DECISIONS.md`。

## 当前完成到哪个任务

- TASK-001（项目脚手架与基础约束）已完成：建立四层目录骨架、工具链与基础约束文档。
- TASK-002（Core 领域原语与枚举）已完成：`src/core/enums.ts` 定义全部领域枚举 + Zod schema，26 项单测。
- TASK-003（Core 任务 frontmatter Schema）已完成：`TaskFrontmatterSchema` / `ContextPackSchema` / `WorkflowOutputsSchema`，28 项单测。
- TASK-004（Core 决策与问题机器字段 Schema）已完成：`DecisionSchema` / `IssueSchema`，40 项单测。

## 当前系统可用能力

- Core 三层 type 资产齐备，可被 frontmatter 解析（TASK-010）、全局文档读写（TASK-012）、SQLite 索引（TASK-014）、状态机（TASK-007）复用：
  - 领域原语：`src/core/enums.ts` 的全部领域枚举 + Zod schema。
  - 任务 frontmatter：`TaskFrontmatterSchema` / `ContextPackSchema` / `WorkflowOutputsSchema`。
  - 决策 / 问题：`DecisionSchema`（§6.6 决策 8 字段）/ `IssueSchema`（§6.7 问题 8 字段）。
- 工具链就绪：`npm run typecheck` / `npm test` / `npm run lint` / `npm run build` 均可执行且全绿（94 项单测）。
- 仍无 CLI 命令、状态机、领域规则、infra 适配实现。

## 当前架构状态

- 分层目录已建立，依赖方向见 `docs/ARCHITECTURE.md` §3。
- `application/ports.ts` 窄接口约定已记录（见 `docs/ARCHITECTURE.md` §4），待 TASK-015 落地代码。
- `Readme.md` 为权威 source_spec + arch，本仓库不另起 `docs/SPEC.md`。
- `src/core/enums.ts` 仅依赖 zod，零反向依赖；`src/core/index.ts` 经 `./enums.js` 再导出（NodeNext 需 `.js` 后缀）。枚举统一采用「Zod schema 为单一来源 + `z.infer` 派生 TS 类型 + `.options` 提供值数组」模式，杜绝类型标注与校验规则漂移。Scope 以异构联合（ScopeStage ∪ TaskId 正则）表达 `SPEC`/`ARCHITECTURE` 与任意 `TASK-XXX` 同为合法值。
- `src/core/schemas/` 目录建立：`task-schema.ts` 仅依赖 zod 与 `../enums.js`，零反向依赖。复合 Schema 沿用 TASK-002「Zod schema 单一来源 + `z.infer` 派生类型」模式，枚举与 id 正则一律复用 `enums.ts`，不重复声明。`src/core/index.ts` 以 `export *` 聚合 enums 与 schemas/task-schema，后续 Schema 文件在此继续追加导出。
- `src/core/schemas/decision-issue-schema.ts` 建立：仅依赖 zod 与 `../enums.js`，零反向依赖。沿用「Zod schema 单一来源 + `z.infer` 派生类型」模式，`DecisionStatus` / `IssueStatus` / `IssueSeverity` / `Scope` 一律复用 `enums.ts`，不重复声明。`src/core/index.ts` 继续 `export *` 聚合新增 Schema。

## 后续任务必须知道的信息

- 分层依赖方向（硬约束）：`cli → application → core ← infrastructure`；`core` 不反向依赖。
- 基础依赖已在 `package.json` 一次性声明（zod / yaml / better-sqlite3 / commander / typescript / vitest / eslint）；后续任务默认**不得新增依赖**，确需新增时在 `.result.md` 提出扩权 / 新增依赖任务建议。
- `tsconfig` 已启用 `strict` + `noUncheckedIndexedAccess`；`tsc --noEmit` 同时覆盖 `src` 与 `test`。
- 工程为 ESM（`"type": "module"`），源码统一使用 ESM 导入。
- 后续 Schema 任务（TASK-005…006）从 `src/core` 导入各 `XxxSchema` 复用，勿另起取值定义；`created_from_task` / 来源类字段用 `ScopeSchema` 校验。`DecisionStatus` / `IssueStatus` / `IssueSeverity` 已由 Orchestrator 确认为权威取值（DEC-001 / ISS-001），并回写 Readme §6.6 / §6.7。
- 后续 frontmatter / 索引 / 解析任务从 `src/core` 导入 `TaskFrontmatterSchema` / `ContextPackSchema` / `WorkflowOutputsSchema` 复用，勿另起结构定义。必填字段集为 `id / title / status / layer / allowed_paths / verification / context_pack / workflow_outputs`；`depends_on / forbidden_paths / permissions / no_review / restart_on_retry` 缺失取默认（`[]` / `false`）。任务文件模板的 `verification` 是字符串数组，与 `.result.md` 的对象数组形态（§10）不是同一结构，切勿混用。`id` 字段复用 `enums.ts` 的 `TaskIdSchema`（`/^TASK-\d+$/`）；DEC-002 / ISS-002 已裁定统一为 `\d+`，TASK-003 §8 已回写。
- Result Schema（TASK-005）从 `src/core` 导入 `DecisionSchema` / `IssueSchema` 组装 `global_update_requests.decisions / issues` 容器，勿另起结构定义。`DecisionSchema` 必填 8 字段（`id / title / status / scope / created_from_task / decision / rationale / consequences`），`IssueSchema` 必填 8 字段（`id / title / status / severity / scope / created_from_task / owner / recommended_action`），缺失即拒。`id` 允许空串（提议态），`DEC-XXX` / `ISS-XXX` 格式校验是 application 层 id 分配职责（TASK-020），不在 Schema 内。`created_from_task` 复用 `ScopeSchema`（`SPEC` / `ARCHITECTURE` / `TASK-\d+`）；`scope` 为自由文本影响范围（非空），DEC-003 / ISS-003 已确认此设计。

## 当前未解决问题摘要

暂无开放问题。ISS-001 / ISS-002 / ISS-003 已于 2026-07-08 全部裁定解决，对应 DEC-001 / DEC-002 / DEC-003 均置 `accepted`；详见 `docs/ISSUES.md` 与 `docs/DECISIONS.md`。

## 建议下一个任务

- TASK-005：Core 执行结果 Schema（layer: `type`，depends_on: TASK-003）。复用 `DecisionSchema` / `IssueSchema` 组装 `global_update_requests` 容器，定义 `.result.md` frontmatter 整体 Schema（含 `execution_status` / `next_action` / `verification` 对象数组 / `modified_files` 等）。
