---
task_id: TASK-015
execution_status: completed
modified_files:
  - src/application/index.ts
created_files:
  - src/application/ports.ts
  - src/application/context-pack-generator.ts
  - test/application/context-pack-generator.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "tsc --noEmit，0 错误（strict + noUncheckedIndexedAccess），Node v22.0.0"
  - command: npm test -- application/context-pack-generator
    result: passed
    notes: "vitest run application/context-pack-generator，1 文件 21 用例全通过（纯函数单测）"
  - command: npm run lint
    result: passed
    notes: "eslint src test，无 error / warning"
  - command: npm test
    result: passed
    notes: "全量回归 14 文件 405 用例全通过（新增 21 项，原 384 不受影响）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "TASK-015（App Context Pack 生成器）已完成：src/application/context-pack-generator.ts 提供 computeContextPack（§8 并集规则）/ refreshSourceFiles（依赖产物刷新 source_files），src/application/ports.ts 定义 application→infra 四个窄接口（TaskDocRepositoryPort / GlobalDocRepositoryPort / WorktreePort / GitMergePort），21 项单测。自此开启 application 层。"
    - section: "当前系统可用能力"
      mode: replace
      content: "Core type 层（TASK-002~006）+ domain 层状态机（TASK-007）+ 领域规则（TASK-008 依赖级联与状态映射、TASK-009 验证 allowlist 与权限解析）齐备；infrastructure 层：frontmatter 解析器 + 任务文档仓储 + 全局文档仓储 + SQLite schema/迁移 + SQLite 索引仓储就绪；application 层开启：Context Pack 生成器 + application→infra 窄接口（Ports）就绪。computeContextPack(task, {dependencyResults})（src/application/context-pack-generator.ts）应用 §8 并集规则产出最终注入清单——required_docs = 必读核心（AGENTS.md / docs/ARCHITECTURE.md / docs/PROGRESS.md / 当前任务文件）∪ frontmatter 声明值去重（必读核心为硬性下限，frontmatter 省略也补齐），optional_doc_excerpts 原样去重，source_files = refreshSourceFiles 产出；当前任务文件路径从 workflow_outputs.result_file 派生（去 .result.md 加 .md，与任务文件共用 slug，DEC-012）。refreshSourceFiles(task, dependencyResults) 用已完成依赖 .result.md 的 modified_files ∪ created_files 替换预填 source_files（all-or-nothing：全部依赖完成才刷新，无依赖 / 任一未完成保留预填，§11）。两函数均为纯计算——不做文件 I/O、不回写 frontmatter（归 TASK-017）、不注入内容（归 TASK-022）。ports.ts（src/application/ports.ts）定义 application 依赖 infra 的唯一通道 4 个 Port：TaskDocRepositoryPort（任务/结果/审查读写，方法集逐项对齐 TaskDocRepository）、GlobalDocRepositoryPort（全局文档 readGlobalDoc/writeGlobalDoc 文件 I/O + applyProgressUpdate/appendDecision/appendIssue/readDecisions/readIssues 正文变换，对齐 GlobalDocRepository）、WorktreePort（create/reset/retain/remove，对齐 TASK-018 WorktreeAdapter）、GitMergePort（rebaseOnto/fastForwardMain/collectPostRebaseCommits/commitAuditResult/branchMerged/abortOrCleanRebase/listConflicts，对齐 TASK-018 GitMergeAdapter）；infra 实现类无需显式 implements，由 CLI composition root（TASK-025）wiring 注入（结构类型兼容）。状态机 / 依赖级联 / 状态映射 / 验证 allowlist / 权限解析 / frontmatter 解析 / 文档仓储 / SQLite 索引同前。工具链 npm run typecheck / npm test（405 项）/ npm run lint 全绿（注：better-sqlite3 原生模块需 Node 22 ABI 127 预编译，见 ISS-005）。仍无 CLI 命令；其余 infra（git worktree、sdk、mcp）适配未实现。"
    - section: "当前架构状态"
      mode: append
      content: "src/application/ports.ts 建立：仅 type-only import core 类型（Decision/ExecutionCommit/Issue/ProgressUpdateRequest/ResultFrontmatter/ReviewFrontmatter/TaskFrontmatter/TaskId），零运行时依赖、零反向依赖（不依赖 infrastructure/cli 实现类，ARCHITECTURE.md §4）。沿用「窄接口 + 结构类型兼容」模式：4 个 Port（TaskDocRepositoryPort / GlobalDocRepositoryPort / WorktreePort / GitMergePort）定义 application→infra 唯一通道，方法集对齐现有 / 计划中的 infra 实现（TaskDocRepository / GlobalDocRepository 正文变换逐项匹配、TASK-018 WorktreeAdapter/GitMergeAdapter 计划方法集），infra 类无需显式 implements、由 CLI composition root wiring 注入。GlobalDocRepositoryPort 的文件 I/O 方法（readGlobalDoc/writeGlobalDoc，GlobalDocName='progress'|'decisions'|'issues'）为前瞻契约——当前 GlobalDocRepository 仅做正文纯变换无 I/O（DEC-009），I/O 由 CLI 层适配器组合 fs + GlobalDocRepository 满足全契约（DEC-012）。GitMergePort.rebaseOnto 冲突不抛断（留待 listConflicts 探测 / abortOrCleanRebase 清理，对齐 TASK-019 §2「失败不抛断」）。src/application/context-pack-generator.ts 建立：仅 type-only import core 的 ContextPack/TaskFrontmatter/TaskId，零反向依赖。沿用「纯函数 + 模块级辅助函数」模式：taskFilePath 从 result_file 派生任务文件路径（失败前置：非 .result.md 结尾抛错不静默），dedupe 保持插入顺序去重，refreshSourceFiles all-or-nothing（hasDeps && every(has) 判定），computeContextPack 组合 refreshSourceFiles + 必读核心并集。DependencyResultSummary 为最小投影结构类型（task_id/modified_files/created_files，兼容 ResultFrontmatter）。noUncheckedIndexedAccess 下 Map.get 返回值用防御性守卫。src/application/index.ts 经 ./ports.js + ./context-pack-generator.js 再导出（NodeNext 需 .js 后缀）。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "Context Pack 生成器复用要点（TASK-015）：computeContextPack(task, {dependencyResults}) 返回 ContextPack（与 frontmatter context_pack 同构 {required_docs, optional_doc_excerpts, source_files}），供 SDK 适配器（TASK-022）据此注入。required_docs 含必读核心 + 当前任务文件（任务文件路径从 workflow_outputs.result_file 派生，frontmatter 不含 slug）；必读核心为硬性下限，frontmatter 省略也补齐。refreshSourceFiles(task, dependencyResults) all-or-nothing：depends_on 非空且全部在 dependencyResults 中 → 用各依赖 modified_files ∪ created_files 并集替换预填 source_files；否则（无依赖 / 任一未完成）原样返回预填。dependencyResults 是 ReadonlyMap<TaskId, DependencyResultSummary>（最小投影 task_id/modified_files/created_files，可由 ResultFrontmatter 直接传入）。TASK-017 状态编排在 ready→running 时调 refreshSourceFiles 取新 source_files → 经 TaskDocRepositoryPort.writeTask 回写 frontmatter → 再调 computeContextPack 产最终清单（或直接复用已回写的 source_files）。技术注记：result_file 不以 .result.md 结尾时 computeContextPack 抛错（§9 约定）；本模块纯计算不做 I/O / 不回写 / 不注入。Ports 复用要点（TASK-015）：application 层（TASK-017/019/020/021）一律经 ports.ts 4 个 Port 访问 infra，禁直接 import infra 实现类。TaskDocRepositoryPort 方法集与 TaskDocRepository 逐项对齐（CLI wiring 直接注入 TaskDocRepository）。GlobalDocRepositoryPort 含文件 I/O（readGlobalDoc/writeGlobalDoc，GlobalDocName 联合）+ 正文变换（对齐 GlobalDocRepository）；当前 GlobalDocRepository 无 I/O，CLI 适配器（TASK-025）组合 fs + GlobalDocRepository 满足全契约——TASK-020 section 回写经 readGlobalDoc 读 → applyProgressUpdate/appendDecision/appendIssue 变换 → writeGlobalDoc 写。WorktreePort / GitMergePort 方法集对齐 TASK-018 WorktreeAdapter/GitMergeAdapter，待 TASK-018 落地后结构性满足。GitMergePort.rebaseOnto 冲突不抛断（TASK-019 用 listConflicts 探测、abortOrCleanRebase 清理）。详见 DEC-012（proposed），待 Orchestrator 确认。"
    - section: "当前未解决问题摘要"
      mode: replace
      content: "TASK-015 无新 issue：仅 type-only import core 类型，未新增 npm 依赖，未触及 core/infrastructure/cli（forbidden 守住），无边界冲突。Context Pack 生成器设计（任务文件路径从 result_file 派生 / refreshSourceFiles all-or-nothing / 必读核心并入 required_docs 输出 / 不扩展范围）与 ports 设计（4 Port 对齐 infra / GlobalDocRepositoryPort 文件 I/O 前瞻契约 / GitMergePort.rebaseOnto 冲突不抛断）系 §8/§9/§11/ARCHITECTURE §4 的合理落地（DEC-012 proposed），非规格偏离。ISS-005（low，open）延续：better-sqlite3@11.10.0 无 Node 25（ABI 141）预编译；本任务纯计算不依赖 SQLite，但后续 CLI 任务受此约束。ISS-004（low，open）延续：VerificationResultSchema 暂置于 result-schema.ts；本任务未引用该枚举，维持现状不阻塞。ISS-001 / ISS-002 / ISS-003 已于 2026-07-08 全部裁定解决。"
    - section: "建议下一个任务"
      mode: replace
      content: "TASK-016：App 拓扑排序与并行检测（layer: domain，depends_on TASK-003 已完成）。落地 src/application/scheduler.ts（拓扑排序 + 并行分组检测），是编号最小的已解锁未完成任务。TASK-017（App 状态流转编排器，depends_on TASK-007/008/011/015 均已完成）亦已随本任务解锁——直接消费 ports.ts，是 application 层首个完整用例，可优先推进。其余已解锁的 infra 任务（TASK-018 git worktree）亦可并行。"
  decisions:
    - id: ""
      title: "Context Pack 生成器与 Ports 设计：任务文件路径从 result_file 派生、refreshSourceFiles all-or-nothing、必读核心并入 required_docs 输出、GlobalDocRepositoryPort 文件 I/O 前瞻契约、GitMergePort.rebaseOnto 冲突不抛断"
      status: proposed
      scope: "application/context-pack-generator + application/ports"
      created_from_task: TASK-015
      decision: "TASK-015 对 §8/§9/§11 与 ARCHITECTURE §4 未明文的设计点作如下解释并落地：（1）任务文件路径派生——当前任务文件属必读核心（§8）但 frontmatter 不含 slug、不计入 required_docs 数组；本模块从 workflow_outputs.result_file（§9 约定 docs/tasks/TASK-XXX-<slug>.result.md）派生任务文件路径：去尾部 .result.md 加 .md（与任务文件共用 slug），纯计算无需 I/O；result_file 不以 .result.md 结尾视为违反 §9 约定，显式抛错不静默（AGENTS §3 不静默）。（2）refreshSourceFiles all-or-nothing——§8「任务转入 running 前若依赖已完成，Orchestrator 用实际 .result.md 清单刷新」+ §11「依赖未完成时不刷新（保留预填）」推论：仅当 depends_on 非空且全部在 dependencyResults 中时，用各依赖 modified_files ∪ created_files 并集替换预填 source_files；无依赖（无可刷新来源）或任一未完成均保留预填。任务转入 running 前依赖必已全部 done（§7），故刷新分支在 ready→running 触发。（3）必读核心并入 required_docs 输出——§8「任务文件本身不计入 required_docs 数组」指 frontmatter 声明值，非计算清单；computeContextPack 的输出 required_docs 含必读核心 + 任务文件（作完整注入文档），frontmatter 省略必读核心也补齐（§8「不得通过省略必读核心缩小范围」）。（4）不扩展范围——输出只取并集去重，最终清单 ⊆ 候选来源（任务 §8）。（5）Ports 设计——4 个 Port（TaskDocRepositoryPort / GlobalDocRepositoryPort / WorktreePort / GitMergePort）方法集对齐现有 / 计划 infra 实现；TaskDocRepositoryPort 逐项匹配 TaskDocRepository，GlobalDocRepositoryPort 正文变换逐项匹配 GlobalDocRepository + 文件 I/O（readGlobalDoc/writeGlobalDoc，GlobalDocName 联合）为前瞻契约（当前 GlobalDocRepository 纯变换无 I/O，DEC-009，CLI 适配器组合 fs 满足），WorktreePort/GitMergePort 对齐 TASK-018 计划方法集；infra 类无需 implements，CLI composition root wiring（ARCHITECTURE §4）。（6）GitMergePort.rebaseOnto 冲突不抛断——对齐 TASK-019 §2「失败（冲突）则返回冲突清单，不抛断」，冲突探测走 listConflicts、清理走 abortOrCleanRebase。"
      rationale: "任务文件路径：frontmatter 无 slug（slug 命名是 CLI task-create 职责，TASK-011 注记），而 result_file 按 §9 含完整 slug 路径，去 .result.md 加 .md 即得任务文件——是最干净的纯计算派生，无需 I/O 也无需 glob。抛错而非静默回退：违反 §9 约定的 result_file 是任务定义错误，应显式暴露（AGENTS §3），静默回退会产出错误清单。refreshSourceFiles all-or-nothing：§8「若依赖已完成」（全部）+ §11「未完成时不刷新」共同指向 all-or-nothing；部分刷新（仅已完成依赖）会让 source_files 混合预填与部分实际产物，语义模糊且与「任务 running 前依赖必全部 done」的运行期不变量冲突。无依赖保留预填：无依赖则无 .result.md 可刷新，预填（Orchestrator 按 allowed_paths/architecture 圈定）即终值。必读核心并入 required_docs 输出：§8「任务文件本身不计入 required_docs 数组」的「数组」特指 frontmatter 声明数组（故模板 required_docs 只列 AGENTS/ARCHITECTURE/PROGRESS），计算清单则需把任务文件作为完整注入文档纳入；放 required_docs（而非新字段）因 ContextPack 三字段结构已固定、任务文件是「完整注入」语义与 required_docs 同类。Ports 对齐 infra：结构类型兼容（ARCHITECTURE §4）要求 Port 方法集与 infra 实现匹配，TaskDocRepositoryPort 逐项对齐保证 CLI 可直接注入 TaskDocRepository；GlobalDocRepositoryPort 的 I/O 是 application 层 TASK-020「重读→合并→回写」的必需（application 不能 import fs），但当前 GlobalDocRepository 经 DEC-009 设计为纯变换无 I/O，故 I/O 作前瞻契约由 CLI 适配器组合满足——这是两仓储设计分工（TaskDocRepository 同步 I/O / GlobalDocRepository 纯变换）的直接推论，非缺陷。rebaseOnto 不抛断：TASK-019 明示合并失败返回冲突清单不抛断，原语层据此设计（rebase 留冲突态，listConflicts 探测），应用层编排冲突处理。"
      consequences: "TASK-017 状态编排复用：ready→running 时调 refreshSourceFiles 取新 source_files → writeTask 回写 frontmatter → computeContextPack 产最终清单（或 TASK-022 直接读已回写的 context_pack）。TASK-022 SDK 适配器按 computeContextPack 输出的 ContextPack 注入文档内容（required_docs 完整注入 / optional_doc_excerpts 按章节 / source_files 允许阅读）。TASK-018 落地 WorktreeAdapter/GitMergeAdapter 后结构性满足 WorktreePort/GitMergePort（方法集已对齐）。TASK-020 section 回写经 GlobalDocRepositoryPort 的 readGlobalDoc→变换→writeGlobalDoc（CLI 适配器组合 fs + GlobalDocRepository 提供 I/O）。TASK-025 CLI composition root wiring：TaskDocRepository 直接注入 TaskDocRepositoryPort；GlobalDocRepositoryPort 注入组合 fs + GlobalDocRepository 的适配器；WorktreePort/GitMergePort 注入 TASK-018 的 Adapter。若 Orchestrator 认为：(a) 任务文件应单列字段而非并入 required_docs——改 computeContextPack 输出结构（届时需同步改 ContextPack Schema + §8）；(b) refreshSourceFiles 应部分刷新（仅已完成依赖）——改 allDepsCompleted 判定为逐依赖累加（与 §11「未完成不刷新」张力）；(c) GlobalDocRepositoryPort 不应含 I/O（改由 application 函数收 doc 内容参数）——TASK-020 调整 writebackGlobalDocs 签名 + 本 Port 删 read/writeGlobalDoc；(d) result_file 派生应容错（非 .result.md 回退 id 模式）——改 taskFilePath 加 fallback（但 slug 未知，需 glob，引入 I/O 违反纯计算）。"
      created_from_task: TASK-015
  issues: []
next_action: review
---

# TASK-015 执行结果

## 1. 执行结论

任务完成。在 `src/application/context-pack-generator.ts` 落地两个纯函数：`computeContextPack(task, {dependencyResults})` 应用 §8 并集规则产出最终 Context Pack 清单（必读核心 ∪ required_docs ∪ optional_doc_excerpts ∪ source_files），`refreshSourceFiles(task, dependencyResults)` 用已完成依赖 `.result.md` 的 `modified_files ∪ created_files` 替换预填 `source_files`（all-or-nothing）。在 `src/application/ports.ts` 定义 application→infra 四个窄接口（`TaskDocRepositoryPort` / `GlobalDocRepositoryPort` / `WorktreePort` / `GitMergePort`），方法集对齐现有 / 计划 infra 实现。`src/application/index.ts` 再导出两模块。`test/application/context-pack-generator.test.ts` 21 项单测覆盖必读核心恒在、并集去重、optional 保留、任务文件路径派生、source_files 刷新（完成 / 未完成 / 无依赖）、不扩展范围。typecheck / test / lint 三项全绿，全量回归 405 项不受影响。自此开启 application 层。

## 2. 完成内容

- `computeContextPack(task, {dependencyResults}): ContextPack`：
  - `required_docs` = 必读核心（AGENTS.md / docs/ARCHITECTURE.md / docs/PROGRESS.md / 当前任务文件）∪ frontmatter 声明值，去重；必读核心为硬性下限，frontmatter 省略也补齐。
  - `optional_doc_excerpts` = frontmatter 声明值去重（原样保留，本模块不裁剪）。
  - `source_files` = `refreshSourceFiles` 产出。
- `refreshSourceFiles(task, dependencyResults): string[]`：
  - all-or-nothing：`depends_on` 非空且全部在 `dependencyResults` → 用各依赖 `modified_files ∪ created_files` 并集替换预填；否则（无依赖 / 任一未完成）原样返回预填。
- `src/application/ports.ts`：
  - `TaskDocRepositoryPort`：`readTask/writeTask/readResult/writeResult/readReview/writeReview/listTasks`（逐项对齐 `TaskDocRepository`）。
  - `GlobalDocRepositoryPort`：文件 I/O `readGlobalDoc/writeGlobalDoc`（`GlobalDocName='progress'|'decisions'|'issues'`）+ 正文变换 `applyProgressUpdate/appendDecision/appendIssue/readDecisions/readIssues`（对齐 `GlobalDocRepository`）。
  - `WorktreePort`：`create/reset/retain/remove`（对齐 TASK-018 WorktreeAdapter）。
  - `GitMergePort`：`rebaseOnto/fastForwardMain/collectPostRebaseCommits/commitAuditResult/branchMerged/abortOrCleanRebase/listConflicts`（对齐 TASK-018 GitMergeAdapter）。
- 模块级导出：`DependencyResultSummary`（最小投影结构类型，兼容 `ResultFrontmatter`）、`ComputeContextPackInput`、`GlobalDocName`。
- 单测 21 项：必读核心恒在（省略补齐 / 任务文件并入 / 已声明去重 / 任务文件路径去重）、optional 保留（声明去重 / 空）、任务文件路径派生（result_file 派生 / 非 .result.md 抛错）、source_files 随依赖刷新（完成=产物并集 / 未完成=预填 / 无依赖=预填）、不扩展范围、refreshSourceFiles（modified+created 合并 / 多依赖并集 / 重复去重 / 替换不含预填 / 空产物空数组 / 任一未完成预填 / 全未提供预填 / 无依赖预填 / 无依赖空预填）。

## 3. 修改文件

- `src/application/index.ts` —— 由 `export {}` 改为再导出 `./ports.js` + `./context-pack-generator.js`，注释「TASK-015：application → infrastructure 窄接口（Ports）与 Context Pack 生成器」。

## 4. 新增文件

- `src/application/ports.ts` —— application→infra 窄接口（4 Port，ARCHITECTURE.md §4）。
- `src/application/context-pack-generator.ts` —— Context Pack 生成器（computeContextPack + refreshSourceFiles，§8）。
- `test/application/context-pack-generator.test.ts` —— 纯函数单测（21 用例）。

## 5. 删除文件

暂无。

## 6. 架构决策

见 frontmatter `global_update_requests.decisions`（DEC-012）：任务文件路径从 `result_file` 派生、`refreshSourceFiles` all-or-nothing、必读核心并入 `required_docs` 输出、不扩展范围、Ports 方法集对齐 infra（`GlobalDocRepositoryPort` 文件 I/O 前瞻契约）、`GitMergePort.rebaseOnto` 冲突不抛断。该决策为 Task Executor 提议（status: proposed），待 Orchestrator 回写确认。

## 7. 偏离计划

无规格偏离。任务 §2 要求的三项（`computeContextPack` / `refreshSourceFiles` / `ports.ts` 四 Port）与 §11 验收（必读核心恒在、source_files 刷新后=依赖实际产物、依赖未完成保留预填、typecheck 0 错误）逐条落地有用例覆盖。任务文件路径派生方式（从 `result_file`）与 `refreshSourceFiles` all-or-nothing 语义是 §8/§9/§11 未明文处的合理解释（DEC-012），不越界、不改规格、不新增依赖。

## 8. 后续任务注意事项

- `computeContextPack(task, {dependencyResults})` 返回 `ContextPack`（与 frontmatter `context_pack` 同构），供 TASK-022 SDK 适配器注入。
- `refreshSourceFiles(task, dependencyResults)` all-or-nothing；TASK-017 在 ready→running 调用 → `writeTask` 回写 → 再产最终清单。
- `dependencyResults` 是 `ReadonlyMap<TaskId, DependencyResultSummary>`（最小投影，可由 `ResultFrontmatter` 直接传入）。
- `result_file` 不以 `.result.md` 结尾时 `computeContextPack` 抛错（§9 约定）。
- application 层一律经 `ports.ts` 4 Port 访问 infra，禁直接 import infra 实现类。
- `TaskDocRepositoryPort` 与 `TaskDocRepository` 逐项对齐（CLI 直接注入）；`GlobalDocRepositoryPort` 文件 I/O 为前瞻契约（CLI 适配器组合 fs + `GlobalDocRepository`）；`WorktreePort`/`GitMergePort` 待 TASK-018 落地后结构性满足。
- `GitMergePort.rebaseOnto` 冲突不抛断（TASK-019 用 `listConflicts` / `abortOrCleanRebase`）。

## 9. 未解决问题

无新 issue。Context Pack 生成器 + Ports 设计（DEC-012 proposed）系 §8/§9/§11/ARCHITECTURE §4 的合理落地，无边界冲突、无新增依赖、未触及 core/infrastructure/cli（forbidden 守住）。ISS-005（better-sqlite3 Node 版本兼容）延续：本任务纯计算不依赖 SQLite。ISS-004（VerificationResultSchema 位置）不阻塞本任务——本任务未引用该枚举。

## 10. 验证结果

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run typecheck` | passed | `tsc --noEmit` 0 错误（Node v22.0.0） |
| `npm test -- application/context-pack-generator` | passed | vitest 1 文件 21 用例全通过（纯函数单测） |
| `npm run lint` | passed | ESLint src/test 无 error/warning |
| `npm test`（全量回归） | passed | 14 文件 405 用例全通过（含新增 21 项） |

## 11. 人工验收建议

- 复核必读核心恒在（§11）：frontmatter `required_docs` 为空时清单仍含 AGENTS.md / docs/ARCHITECTURE.md / docs/PROGRESS.md + 当前任务文件（见「必读核心恒在」测试组）。
- 复核 source_files 刷新（§11）：依赖全部完成 → source_files = 各依赖 modified_files ∪ created_files 并集（预填被替换）；依赖未完成 / 无依赖 → 保留预填（见「source_files 随依赖刷新」+「refreshSourceFiles」测试组）。
- 复核不扩展范围（§8）：最终清单 ⊆ 候选来源，不引入额外文件（见「不扩展范围」测试）。
- 复核任务文件路径派生（DEC-012）：从 `result_file` 去 `.result.md` 加 `.md`；非 `.result.md` 结尾抛错。
- 确认 DEC-012 设计点（任务文件路径派生 / all-or-nothing / 必读核心并入 required_docs 输出 / Ports 对齐 infra + GlobalDocRepositoryPort I/O 前瞻契约 / rebaseOnto 不抛断）是否符合 §8/§9/§11/ARCHITECTURE §4。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（6 个 section：完成进度 append、能力 replace、架构 append、后续须知 append、未解决问题 replace、下一任务 replace）、decisions（1 条 proposed：DEC-012 Context Pack 生成器与 Ports 设计）、issues（无新增，ISS-005 / ISS-004 延续）。由 Orchestrator 在合并回 main 后统一回写 `docs/PROGRESS.md` / `docs/DECISIONS.md` / `docs/ISSUES.md`。
