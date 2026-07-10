---
task_id: TASK-024
execution_status: completed
modified_files:
  - src/cli/framework.ts
created_files:
  - src/cli/commands/plan.ts
  - src/cli/commands/task-create.ts
  - test/cli/plan.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: 0 错误（strict + noUncheckedIndexedAccess）
  - command: npm test -- cli/plan
    result: passed
    notes: 29 项单测全绿（slugify / buildTaskBody / createSingleTask / parsePlanDefinition / planProject standard·bootstrap·任务图 / runCli 退出码）
  - command: npm run lint
    result: passed
    notes: eslint 0 错误
  - command: npm test
    result: passed
    notes: 全量 680 项单测全绿（Node v22.23.1，含 SQLite 测试），无回归
global_update_requests:
  progress:
    - section: 当前完成到哪个任务
      mode: append
      content: >-
        TASK-024（CLI plan 与 task:create 命令）已完成（实际插入于 TASK-023 与 TASK-025 之间，Step 5 直接编辑 PROGRESS.md 维持数值顺序）。
    - section: 当前系统可用能力
      mode: append
      content: >-
        CLI plan / task:create 命令就绪（详见能力清单新增条目）。
    - section: 建议下一个任务
      mode: replace
      content: >-
        全部 29 个任务（TASK-001 ~ TASK-024）已完成；进入 §11 第 10 步项目收尾（全量验证 + PROGRESS 终态快照 + ISSUES 遗留归档 / tag / 发版）。
  decisions:
    - id: ""
      title: >-
        plan / task:create CLI 命令设计——计划定义经 --from 配置文件提供、ISS-018「已审查」用 --reviewed 标志、task-create 拥有共享 writeTaskFile/buildTaskBody/slugify 供 plan 复用、先校验任务图后写盘、task:create 拒绝覆盖既有文件
      status: proposed
      scope: cli/commands/plan.ts + task-create.ts
      created_from_task: TASK-024
      decision: >-
        plan 接受 --from <YAML/JSON> 提供显式计划定义（title+phases+tasks，PlanningWorkflow 不做智能拆分，§7/§12），--reviewed 标志作 ISS-018「已审查」机器判据（standard 必需），--source-spec 走 bootstrap；planProject 顺序为 validatePlanningInputs → createPlanDraft + createTaskDrafts → validateTaskGraph（先校验后写盘，避免环留部分文件）→ 落盘 PLAN.md + 任务文件。task-create.ts 导出共享 writeTaskFile（serializeDocument + §9 十三节正文模板）/ buildTaskBody / slugify 供 plan.ts 跨命令 import（延续 ISS-015）；taskFileFromResult 就地重实现（task-run.ts 私有未导出）。task:create 拒绝覆盖既有任务文件，slug 从 title 派生或 --slug 显式提供（纯中文标题派生空时要求显式 --slug）。
      rationale: >-
        §7 明令不在 CLI 实现智能拆分、§12 限本任务为可一次闭环骨架，故计划定义显式提供而非模型生成；ISS-018 要求机器化「已审查」判据，--reviewed 标志最明确（AGENTS §3 显式能力声明，不依赖启发式）；共享 writeTaskFile 落 task-create 因「新建任务文件 + 正文模板」是 task:create 的天然职责、plan 批量复用顺理成章，避免重复正文模板；先校验任务图后写盘避免依赖环 / 重复 id 留下半成品任务文件污染 docs/tasks；task:create 拒绝覆盖因创建已存在任务几乎总是 id 冲突误操作。
      consequences: >-
        智能拆分（SPEC/ARCHITECTURE → 任务草案）仍需独立后续任务（§12，当前以显式配置文件闭环骨架交付）；taskFileFromResult 三处重实现（task-run / task-create / 此处）待 ISS-015 提议的 cli 共享助手模块收口；--reviewed 标志为 standard 模式硬性前置，未携带且无 sourceSpec 时拒绝生成（ISS-018 落地）。
  issues:
    - id: ISS-018
      title: validatePlanningInputs 的 specReviewed/architectureReviewed 判定来源未机器化定义
      status: resolved
      severity: low
      scope: cli/commands/plan.ts
      created_from_task: TASK-029
      owner: Orchestrator
      recommended_action: 已由 TASK-024 落地——plan 命令以 --reviewed 布尔标志作「SPEC/ARCHITECTURE 已通过 Reviewer 独立审查」的机器判据传入 validatePlanningInputs，standard 模式硬性前置。
    - id: ISS-013
      title: CLI 命令任务的 allowed_paths 应含 framework.ts
      status: resolved
      severity: low
      scope: docs/tasks + src/cli/framework.ts
      created_from_task: TASK-025
      owner: Orchestrator
      recommended_action: TASK-024 延续先例（同层 src/cli 增量注册 plan/task:create）。CLI 命令任务（TASK-023/024/025/026/027）现已全部完成，无后续任务需套用本建议，ISS-013 不再可操作，标记 resolved。
next_action: review
---

# TASK-024 执行结果

## 1. 执行结论

TASK-024 完成。在 CLI 层组合 TASK-029 PlanningWorkflow + TASK-011 文档协议，实现 `caw plan`（SPEC/ARCHITECTURE 或自举 source_spec + 计划定义 → PLAN.md + docs/tasks/TASK-XXX.md）与 `caw task:create`（按入参生成单个任务文件）两条命令。plan 产出的任务文件均过 `TaskFrontmatterSchema`、status=draft、context_pack 含预填 source_files；task:create 单任务文件合法。typecheck / lint / 全量 680 测试全绿，无回归。

## 2. 实际改动文件清单

### 新增

- `src/cli/commands/plan.ts`：`planProject({projectRoot, reviewed, definition})` 编排入口——判 SPEC/ARCHITECTURE 存在 + `--reviewed` 判审查 → `validatePlanningInputs`（standard / bootstrap / failed）→ `createPlanDraft` + `renderPlanMarkdown` 落盘 PLAN.md → `createTaskDrafts`（draft + 预填 context_pack）→ `validateTaskGraph`（先校验后写盘，环 / 重复 id 抛错、路径冲突 warning）→ 落盘任务文件。`parsePlanDefinition(raw)` 经 `PlanDefinitionSchema`（复用 core TaskIdSchema / LayerSchema / PermissionSchema）校验 YAML/JSON 配置。`registerPlanCommand`（`plan --from <file> [--reviewed] [--project-root]`）。
- `src/cli/commands/task-create.ts`：`createSingleTask(input)` 单任务创建入口——组装 TaskDraftSpec → `createTaskDrafts` 校验 + 预填 context_pack → `writeTaskFile` 落盘；id / layer / slug 前置校验、既有文件拒绝覆盖。共享导出：`writeTaskFile(tasksDir, draft)`（serializeDocument + §9 十三节正文模板，供 plan 复用）/ `buildTaskBody(task)` / `slugify(title)` / `taskFileFromResult`（就地重实现，task-run.ts 私有未导出）。`registerTaskCreateCommand`（`task:create --id --title --layer [--slug] [--depends-on] [--allowed-paths] ... [--project-root]`）。
- `test/cli/plan.test.ts`：29 项单测覆盖 slugify / buildTaskBody / createSingleTask（合法 / 非法 id·layer·slug / 重复拒绝 / 正文模板）/ parsePlanDefinition（YAML / JSON / 缺字段 / 空 phases / 非法语法）/ planProject（standard 全链 / 未 reviewed 拒绝 / bootstrap 自举 preface / 依赖环抛错不落盘 / 路径冲突 warning 正常生成）/ runCli（plan / task:create 退出码 + createProgram 注册）。

### 修改

- `src/cli/framework.ts`：`createProgram()` 追加注册 plan / task:create（2 行 import + 2 行注册 + 注释更新）。同层 src/cli 增量改动（ISS-013 延续，framework.ts 不在本任务 allowed_paths 但不在 forbidden_paths，沿 TASK-025/026/027 先例）。

## 3. 验证结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | ✅ passed | 0 错误（strict + noUncheckedIndexedAccess） |
| `npm test -- cli/plan` | ✅ passed | 29 项单测全绿 |
| `npm run lint` | ✅ passed | eslint 0 错误 |
| `npm test` | ✅ passed | 全量 680 项全绿（Node v22.23.1），无回归 |

## 4. 设计要点

- **plan 输入来源**：PlanningWorkflow 不做「SPEC → 任务」AI 拆分（任务 §7），本任务只做可一次闭环骨架（任务 §12）。故 plan 经 `--from <YAML/JSON>` 接受显式计划定义（title + phases + tasks），配置级经 `PlanDefinitionSchema`（复用 core 枚举 Schema）先拦截非法 id / layer / 空字段，`createTaskDrafts` 再做完整 `TaskFrontmatterSchema` 校验 + `computeContextPack` 预填。
- **ISS-018 落地**：「已审查」机器判据采用 `--reviewed` 布尔标志（AGENTS §3 显式能力声明）。standard 模式（SPEC+ARCH 存在 + reviewed）必需该标志；未携带且无 sourceSpec → 拒绝生成。
- **先校验后写盘**：`planProject` 顺序为 validatePlanningInputs → createPlanDraft（模型）→ createTaskDrafts（模型）→ validateTaskGraph（环 / 重复 id 抛错）→ 落盘 PLAN.md + 任务文件。依赖环 / 重复 id 在落盘前拦截，不产生半成品任务文件。
- **共享 writeTaskFile**：落 task-create.ts（「新建任务文件 + 正文模板」是其天然职责），plan.ts 跨命令 import 复用（延续 ISS-015）。`taskFileFromResult` 就地重实现（task-run.ts 私有未导出，ISS-015 范畴）。
- **task:create 拒绝覆盖**：创建已存在任务几乎总是 id 冲突误操作，拒绝覆盖并提示更换 id 或先删除。
- **正文模板**：§9 十三节，frontmatter 可派生字段（layer / 必读文件 / 修改范围 / 禁止范围 / result_file）预填，其余占位。

## 5. 遗留 issue 与 next_action

- ISS-018 / ISS-013 由本任务落地解决（详见 global_update_requests.issues）。
- 智能拆分（SPEC/ARCHITECTURE → 任务草案）未实现（§7/§12 明令不做，DEC-028 consequences 记录），留作独立后续任务（当前以显式配置文件闭环骨架交付）。
- taskFileFromResult 三处重实现（task-run / task-create）待 ISS-015 提议的 cli 共享助手模块收口。

next_action: review（本任务 no_review: false，请 Reviewer 独立审查）。
