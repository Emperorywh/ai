---
task_id: TASK-029
execution_status: completed
modified_files:
  - src/application/index.ts
created_files:
  - src/application/planning-workflow.ts
  - test/application/planning-workflow.test.ts
deleted_files: []
execution_commits: []
next_action: review
verification:
  - command: npm run typecheck
    result: passed
    notes: 0 错误（strict + noUncheckedIndexedAccess + NodeNext）
  - command: npm test -- application/planning-workflow
    result: passed
    notes: 32 项单测全绿（validatePlanningInputs 7 + createPlanDraft/renderPlanMarkdown 7 + createTaskDrafts 8 + validateTaskGraph 10；含 standard/bootstrap/reject 三态、source_files 依赖预填/显式覆盖/外部依赖、computeContextPack 必读核心+任务文件、2-环/3-环/重复 id/路径冲突/依赖对不计冲突）
  - command: npm run lint
    result: passed
    notes: eslint 0 错误 0 警告
  - command: npm test
    result: skipped
    notes: 全量回归中 SQLite 相关测试在 Node v24.3.0（ABI 137）下因 better-sqlite3 无预编译二进制失败（ISS-005 既有环境约束，要求 Node 22 ABI 127），与本任务零相关（规划用例不依赖 SQLite）；本任务相关测试（application/planning-workflow 32 项）全绿。
global_update_requests:
  progress:
    - section: 当前完成到哪个任务
      mode: append
      content: "- TASK-029（App 规划文档生成与任务拆分用例）已完成：`src/application/planning-workflow.ts` 提供 `PlanningWorkflow` 四用例——`validatePlanningInputs(input)`（校验 SPEC/ARCHITECTURE 存在且已审查 → standard，或自举 source_spec → bootstrap + needsHumanConfirmation:true，否则拒绝带 missing 清单；纯逻辑校验，文件存在性 / 审查状态作显式输入，不读文件）、`createPlanDraft(input)`（显式阶段 → PLAN 草案模型，分配 1-based order + 生成 preface 审查 / 自举声明 + `renderPlanMarkdown` 渲染）、`createTaskDrafts(input)`（显式 spec 集合 → TaskFrontmatter[]，初始 status: draft，source_files 按依赖 allowed_paths 并集预填 §8，调 computeContextPack 产初始注入清单；frontmatter 存裁剪声明、TaskDraftResult.contextPack 存完整清单）、`validateTaskGraph(tasks)`（复用 scheduler topologicalOrder 检环 + core detectDependencyCycle 取环路径 + detectParallelizable 推断路径冲突；ok = 无重复 id 且无环，路径冲突为 warning 不阻断）。32 项单测。P4 收尾，解除 TASK-024 阻塞。"
    - section: 当前系统可用能力
      mode: append
      content: "  - 规划工作流：`PlanningWorkflow`（`src/application/planning-workflow.ts`）承载 SPEC/ARCHITECTURE → PLAN → 任务拆分的 application 用例，产出计划与任务的领域模型，不调用模型 / 不做文件 I/O / 不改规格（任务 §7）。`validatePlanningInputs(PlanningInputs): PlanningValidationResult` 判别联合——standard（SPEC+ARCH 存在且已审查）/ bootstrap（source_spec 替代 + needsHumanConfirmation:true）/ failed（missing 清单）；标准优先，空白 sourceSpec 视为未声明。`createPlanDraft(PlanDraftInput): PlanDraft` 基于**显式阶段**组装（不硬编码 §6.4 推荐顺序，任务 §8）——分配 1-based order、生成 preface（标准声明审查通过 / 自举声明 source_spec + 人工确认）、`renderPlanMarkdown(draft)` 渲染落盘；空 phases / 重复阶段名 / 空阶段名抛错。`createTaskDrafts(TaskDraftsInput): TaskDraftsResult` 组装 TaskFrontmatter[]（status 固定 draft，任务 §8），经 TaskFrontmatterSchema 校验（任务 §11 验收）；source_files 预填（§8：spec 显式提供用之，否则按 depends_on 各依赖 allowed_paths 并集）；调 computeContextPack 产 `TaskDraftResult.contextPack`（完整注入清单含必读核心 ∪ 任务文件）；frontmatter.context_pack 存裁剪声明（不含任务文件，§8 入口载体不计入 required_docs 数组）；重复 id / 非法 result_file 抛错。`validateTaskGraph(TaskFrontmatter[]): TaskGraphValidationResult`——duplicateIds（先检测避免误判环）/ hasCycle（topologicalOrder catch）+ cyclePath（detectDependencyCycle）/ pathConflicts（对每对**互无依赖**任务喂 detectParallelizable([A,B])，两单元素批次 = 冲突）/ ok（无重复 id 且无环，路径冲突不阻断）。完全复用 scheduler + core 公开 API，零重复私有逻辑。"
    - section: 当前架构状态
      mode: append
      content: "- `src/application/planning-workflow.ts` 建立：仅 type-only import core 的 ContextPack/Layer/Permission/TaskFrontmatter/TaskId + 值 import core 的 TaskFrontmatterSchema（运行时校验产物合法性）/ detectDependencyCycle（环路径诊断）+ 值 import 同层 `./context-pack-generator.js`（computeContextPack + type DependencyResultSummary）+ 值 import 同层 `./scheduler.js`（topologicalOrder + detectParallelizable），零反向依赖（不 import infrastructure/cli，ARCHITECTURE §4；不做文件 I/O——任务 §7，文件存在性 / 审查状态作显式输入传入）。沿用「纯函数 + 判别联合 + Result 抛错」模式（承接 DEC-004/014）：validatePlanningInputs 返回 PlanningValidationResult 判别联合（standard/bootstrap/failed），createTaskDrafts 内部 TaskFrontmatterSchema.parse 校验产物 + computeContextPack 产完整清单。source_files 预填用 byId Map 索引依赖 spec（插入序去重）。validateTaskGraph 路径冲突检测**完全复用 scheduler.detectParallelizable**——对每对互无依赖任务单独喂 [A,B]，单批次 = 可并行 / 两单元素批次 = 冲突；零重复 scheduler 私有 pathsOverlap/literalPrefix/normalizePath 等逻辑（判定一致性天然保证），代价 O(n²) 次 detectParallelizable 调用（规划期一次性，任务数有限可接受）。环检测用 topologicalOrder（复用调度器，任务 §2 字面）catch 抛错 + core detectDependencyCycle 取闭合环路径（诊断）。重复 id 先检测（避免 topologicalOrder 内 assertUniqueIds 抛错被误判为环）。`noUncheckedIndexedAccess` 下数组索引 tasks[i] 用 undefined 守卫。`src/application/index.ts` 追加 `./planning-workflow.js` 再导出（NodeNext 需 `.js` 后缀）。"
    - section: 后续任务必须知道的信息
      mode: append
      content: "- 规划工作流复用要点（TASK-029）：`PlanningWorkflow`（`src/application/planning-workflow.ts`）是 SPEC/ARCHITECTURE → PLAN → 任务拆分的 application 用例，产出领域模型**不落盘**（任务 §7）。`validatePlanningInputs(PlanningInputs)` 接收**显式布尔**（specExists/architectureExists/specReviewed/architectureReviewed + 可选 sourceSpec）——**application 不读文件**，文件存在性 / 审查状态由 CLI composition root（TASK-024 plan 命令）判定后传入（见 ISS-018：「已审查」的机器化判据待 TASK-024 定义）。standard（SPEC+ARCH 存在且已审查）/ bootstrap（source_spec + needsHumanConfirmation:true）/ failed（missing 清单）；标准优先。`createPlanDraft(PlanDraftInput)` 接收**显式阶段**（不硬编码 §6.4）→ PlanDraft（1-based order + preface）+ `renderPlanMarkdown(draft)`；`createTaskDrafts(TaskDraftsInput)` 接收 TaskDraftSpec[] → `{ drafts: [{ task: TaskFrontmatter(draft), contextPack: ContextPack }] }`；source_files 预填规则（§8）：spec.source_files 提供用之，否则按 depends_on 各依赖（同批）allowed_paths 并集；frontmatter.context_pack 存裁剪声明（不含必读核心 / 任务文件，运行时由 computeContextPack 并入），TaskDraftResult.contextPack 存完整清单。`validateTaskGraph(TaskFrontmatter[])` → `{ duplicateIds, hasCycle, cyclePath, pathConflicts, ok }`；路径冲突复用 detectParallelizable([A,B]) 推断（零重复私有逻辑），ok = 无重复 id 且无环（路径冲突为 warning 不阻断）。TASK-024（cli-plan-and-task-create，被本任务阻塞，**现已解除**）在 CLI 层组合：读 SPEC/ARCHITECTURE 判存在 / 审查 → validatePlanningInputs → createPlanDraft + renderPlanMarkdown 落盘 PLAN.md → createTaskDrafts + 任务文件正文模板 → 落盘 docs/tasks/TASK-XXX.md；另需定义「已审查」机器化判据（ISS-018）与任务文件 13 节正文模板（本任务只产 frontmatter 模型）。详见 DEC-025/026/027（proposed）+ ISS-018（low，open）。"
    - section: 建议下一个任务
      mode: replace
      content: "- TASK-024：CLI plan 与 task:create 命令（layer: `page`，depends TASK-011/015/016/**TASK-029 ✅**——本任务完成后阻塞解除）—— 在 CLI 层组合 PlanningWorkflow（TASK-029）+ 文档仓储（TASK-011）实现 `caw plan`（SPEC/ARCHITECTURE → PLAN.md）与 `caw task:create`（任务拆分 → docs/tasks/TASK-XXX.md）命令，含「已审查」机器化判据（ISS-018）与任务文件正文模板。TASK-024 与 TASK-029 是仅剩两个未完成任务；TASK-029 已完成，TASK-024 解除阻塞成为下一个可执行任务（编号最小且 depends 全完成）。本任务（TASK-029）P4 收尾。"
    - section: 当前未解决问题摘要
      mode: append
      content: "- ISS-018（low，open）新增自 TASK-029：`validatePlanningInputs` 的 specReviewed/architectureReviewed 判定来源未机器化定义——Readme §11 第 4 步要求 Reviewer 独立审查 SPEC/ARCHITECTURE，但「审查通过」的机器化判据（如检查某文件 / 标志 / ISSUES 无 SPEC|ARCHITECTURE 相关 open 项 / 人工确认标志）未在工作流中明确。本任务 application 层只消费布尔（不读文件，§7），故作为显式输入由调用方传入，不阻塞本任务验收；TASK-024 plan 命令需确定判定方式（如要求显式 `--reviewed` 标志或基于 DECISIONS/ISSUES 记录）。详见 ISS-018。"
  decisions:
    - id: ""
      title: 规划用例纯逻辑校验——application 不读文件，文件存在性 / 审查状态作显式输入
      status: proposed
      scope: TASK-029
      created_from_task: TASK-029
      decision: "PlanningWorkflow 的 validatePlanningInputs 接收显式布尔输入（specExists / architectureExists / specReviewed / architectureReviewed + 可选 sourceSpec），application 层不读文件、不做 I/O。文件存在性与审查状态由 CLI composition root（TASK-024 plan 命令）判定后传入。standard（SPEC+ARCH 存在且已审查）/ bootstrap（source_spec 替代 + needsHumanConfirmation:true）/ failed（missing 清单）三态判别联合；标准模式优先（即便同时声明 source_spec）。"
      rationale: "application 层定位是「产出领域模型」，文件 I/O 与存在性判定属 CLI / infra 职责（ARCHITECTURE §4 经 ports 访问 infra，但规划期前置校验的「文件存在 / 已审查」更适合 CLI 直接判定后传布尔，避免为前置校验引入新的 fs port）。任务 §7「不写文件」精神延伸至读：application 只产模型。判别联合（非抛错）让调用方据 failed.missing 展示给人工，不静默。标准优先符合 §6「目标项目通过 SPEC+ARCHITECTURE 承载长期协议」。自举 needsHumanConfirmation 固定 true 落实 §11 验收「自举必须返回需人工确认的标记」。"
      consequences: "TASK-024 plan 命令须在 CLI 层判定文件存在 + 审查状态后传布尔（需定义「已审查」机器化判据，见 ISS-018）；本用例可在纯单元测试中覆盖三态（无需临时目录 / 文件夹具）。validatePlanningInputs 不依赖任何 port，零 I/O 副作用。"
    - id: ""
      title: createTaskDrafts 的 source_files 预填 + context_pack 双层存储
      status: proposed
      scope: TASK-029
      created_from_task: TASK-029
      decision: "createTaskDrafts 的 source_files 预填规则（§8）：spec.source_files 显式提供则用之，否则按 depends_on 各依赖任务（同一批 drafts）的 allowed_paths 并集预填（依赖指向集合外任务时跳过）。context_pack 双层存储：frontmatter.context_pack 存「裁剪声明」（required_docs / optional_doc_excerpts 来自 spec + 预填 source_files，**不含**必读核心与任务文件），TaskDraftResult.contextPack 存 computeContextPack 产出的「完整注入清单」（必读核心 ∪ 任务文件 ∪ 声明）。"
      rationale: "§8 明文「拆分阶段依赖尚未执行，先按依赖 allowed_paths 预填 source_files」——故默认按依赖预填；spec.source_files 显式提供时尊重调用方精确控制（如纯计算任务无写路径但需读特定源码）。双层存储符合 context-pack-generator 设计（CORE_REQUIRED_DOCS 是运行时下限、frontmatter 省略也补齐）+ §8「当前任务文件是入口载体、不计入 required_docs 数组」——故 frontmatter 不存任务文件；而 TaskDraftResult.contextPack 调 computeContextPack 产出完整清单，供调用方预览实际注入范围（含任务文件），满足任务 §2「调用 computeContextPack 生成初始 context_pack」。"
      consequences: "TASK-024 落盘任务文件时写 frontmatter（裁剪声明，与现有项目任务文件一致——required_docs 不含任务文件）；TaskDraftResult.contextPack 供 CLI 预览 / 日志，不落盘。后续 ready→running 时 refreshSourceFiles 读 frontmatter.context_pack.source_files（预填值）用依赖 .result.md 实际产物替换，链路自洽。"
    - id: ""
      title: validateTaskGraph 完全复用 scheduler 公开 API 检测环与路径冲突，零重复私有逻辑
      status: proposed
      scope: TASK-029
      created_from_task: TASK-029
      decision: "validateTaskGraph 完全复用已有公开 API，不重新实现 scheduler 私有路径判定：依赖环用 scheduler.topologicalOrder（遇环抛错 → hasCycle:true）+ core detectDependencyCycle 取闭合环路径（诊断）；allowed_paths 路径冲突用 scheduler.detectParallelizable——对每对**互无依赖**任务 (A,B) 单独喂 detectParallelizable([A,B])，返回两单元素批次 [[A],[B]] 即判冲突。重复 id 先单独检测（避免 topologicalOrder 内 assertUniqueIds 抛错被误判为环）。ok = 无重复 id 且无环（路径冲突为 warning 不阻断，§3.2 默认串行）。"
      rationale: "任务 §2「复用调度器检测依赖环和 allowed_paths 并行冲突」字面要求复用 scheduler。scheduler 的 pathsOverlap / literalPrefix / normalizePath 为模块私有未导出，本任务 forbidden / allowed 不含 scheduler.ts（无法改其导出），重新实现这 ~50 行属复制粘贴（违反 AGENTS §3）。通过对每对无依赖任务单独喂 detectParallelizable([A,B])，用其「单批次 = 可并行 / 两单元素批次 = 冲突」语义反推冲突对，**零重复** scheduler 私有逻辑，且判定一致性天然保证（同一函数）。代价是 O(n²) 次 detectParallelizable 调用，但规划期一次性校验、任务数有限（本项目 29 个），完全可接受。环路径用 core detectDependencyCycle（返回闭合路径，比 topologicalOrder 的抛错形态更具诊断价值）。"
      consequences: "validateTaskGraph 零路径判定重复逻辑（避免 ISS-015 类技术债）；路径冲突检测不暴露具体重叠路径对（仅 taskA/taskB），调用方可自行查 allowed_pages；detectPathConflicts 对同 id 对与有依赖对跳过（避免 detectParallelizable 抛错）。大任务集（数百）下 O(n²) detectParallelizable 可能有性能开销，届时可优化为单次全图 detectParallelizable + 层内配对。"
  issues:
    - id: ""
      title: validatePlanningInputs 的 specReviewed/architectureReviewed 判定来源未机器化定义
      status: open
      severity: low
      scope: TASK-029
      created_from_task: TASK-029
      owner: Orchestrator
      recommended_action: "TASK-024（cli-plan-and-task-create）plan 命令在 CLI 层组合 validatePlanningInputs 时，需确定「SPEC/ARCHITECTURE 已审查」的机器化判据——可选：(A) 要求显式 `--reviewed` / `--bootstrap <source_spec>` 标志由人工声明；(B) 检查 docs/ISSUES.md 无 created_from_task 为 SPEC/ARCHITECTURE 的 open 项；(C) 检查 docs/DECISIONS.md 是否有 SPEC/ARCHITECTURE 阶段审查通过记录。当前 application 层只消费布尔（不读文件，§7），不阻塞本任务验收。"
---

# TASK-029 App 规划文档生成与任务拆分用例 执行结果

## 1. 执行结论

已完成。落地 `PlanningWorkflow`（`src/application/planning-workflow.ts`）四用例：

- **validatePlanningInputs(input)**：校验规划前置——standard（SPEC+ARCHITECTURE 存在且已审查）/ bootstrap（自举 source_spec + needsHumanConfirmation:true）/ failed（missing 清单）。**纯逻辑校验，不读文件**：文件存在性 / 审查状态作为显式布尔输入（任务 §7）。标准模式优先；空白 sourceSpec 视为未声明。
- **createPlanDraft(input)**：基于**显式阶段**（不硬编码 §6.4 推荐顺序，任务 §8）生成 PLAN 草案模型——分配 1-based order、生成 preface（标准声明审查通过 / 自举声明 source_spec + 人工确认）；`renderPlanMarkdown(draft)` 渲染为 markdown 供 CLI 落盘。空 phases / 重复阶段名 / 空阶段名显式抛错。
- **createTaskDrafts(input)**：组装 TaskFrontmatter[]，**status 固定 draft**（任务 §8），经 TaskFrontmatterSchema 校验（任务 §11 验收）；source_files 预填（§8：显式提供用之，否则按 depends_on 各依赖 allowed_paths 并集）；调 computeContextPack 产完整初始注入清单。重复 id / 非法 result_file 抛错。
- **validateTaskGraph(tasks)**：复用 scheduler（topologicalOrder 检环 + detectParallelizable 推断路径冲突）+ core（detectDependencyCycle 取环路径）；ok = 无重复 id 且无环，路径冲突为 warning 不阻断（§3.2 默认串行）。

**零反向依赖**：仅 import core 类型 / Schema + 同层 application 模块（computeContextPack / topologicalOrder / detectParallelizable），不 import infrastructure/cli（ARCHITECTURE §4）。**零 npm 新增**。

## 2. 实际改动文件清单

新建：

- `src/application/planning-workflow.ts`——PlanningWorkflow 四用例 + 类型（PlanningInputs / PlanningValidationResult 判别联合 / PlanDraftInput / PlanDraft / TaskDraftSpec / TaskDraftsResult / TaskGraphValidationResult / PathConflict）+ `renderPlanMarkdown`。
- `test/application/planning-workflow.test.ts`——32 项单测（夹具 makeFrontmatter / makeSpec）。

修改：

- `src/application/index.ts`——追加 `export * from './planning-workflow.js'`（TASK-029 规划工作流再导出）。

未触及 forbidden（src/core / src/infrastructure / src/cli 均未修改，仅 type/value import core 与同层 application）。

## 3. 验证结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | ✅ passed | 0 错误（strict + noUncheckedIndexedAccess + NodeNext） |
| `npm test -- application/planning-workflow` | ✅ passed | 32 项全绿 |
| `npm run lint` | ✅ passed | eslint 0 错误 0 警告 |
| `npm test`（全量） | ⏭ skipped | SQLite 测试在 Node v24（ABI 137）下因 better-sqlite3 无预编译失败（ISS-005），与本任务零相关 |

## 4. 设计要点

- **纯逻辑校验**：validatePlanningInputs 不读文件，文件状态作显式输入（DEC-025）。三态判别联合（非抛错）让 CLI 据 failed.missing 展示给人工。
- **source_files 预填 + context_pack 双层**：frontmatter 存裁剪声明（不含任务文件，§8 入口载体），TaskDraftResult.contextPack 存 computeContextPack 完整清单（DEC-026）。
- **零重复路径判定**：validateTaskGraph 路径冲突检测对每对无依赖任务喂 detectParallelizable([A,B]) 推断，完全复用 scheduler 公开 API，不复制其私有 pathsOverlap/literalPrefix（DEC-027，规避 ISS-015 类技术债）。
- **环检测双 API**：topologicalOrder catch 判 hasCycle（复用调度器，§2 字面）+ detectDependencyCycle 取闭合环路径（诊断）。

## 5. 遗留 issue 与 next_action

- **ISS-018（low，open）**：validatePlanningInputs 的 specReviewed/architectureReviewed 判定来源未机器化定义，待 TASK-024 plan 命令确定（不阻塞本任务）。
- **next_action: review**——本任务实现干净（无越界、无 npm 新增、forbidden 守住、验证全绿），请 Reviewer 审查。

## 6. 解除的阻塞

TASK-024（cli-plan-and-task-create）的 depends_on 含 TASK-029，本任务完成后 TASK-024 阻塞解除，成为下一个可执行任务（编号最小且 depends 全完成）。
