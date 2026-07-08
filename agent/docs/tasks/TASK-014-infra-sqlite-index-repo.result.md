---
task_id: TASK-014
execution_status: completed
modified_files:
  - src/infrastructure/index.ts
created_files:
  - src/infrastructure/sqlite/index-repo.ts
  - test/infrastructure/sqlite/index-repo.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "tsc --noEmit，0 错误（strict + noUncheckedIndexedAccess），Node v22.0.0"
  - command: npm test -- infrastructure/sqlite/index-repo
    result: passed
    notes: "vitest run infrastructure/sqlite/index-repo，1 文件 24 用例全通过（内存 SQLite + 临时目录集成）"
  - command: npm run lint
    result: passed
    notes: "eslint src test，无 error / warning"
  - command: npm test
    result: passed
    notes: "全量回归 13 文件 384 用例全通过（新增 24 项，原 360 不受影响）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "TASK-014（Infra SQLite 索引仓储与 rebuild-index）已完成：src/infrastructure/sqlite/index-repo.ts 提供 IndexRepository（upsertTask/Decision/Issue/Execution 写入容错不阻断、queryTasks(filter)/getExecution(taskId) 查询、rebuildFromDocs 从文档全量重建），24 项内存 SQLite + 临时目录集成单测。"
    - section: "当前系统可用能力"
      mode: replace
      content: "Core type 层（TASK-002~006）+ domain 层状态机（TASK-007）+ 领域规则（TASK-008 依赖级联与状态映射、TASK-009 验证 allowlist 与权限解析）齐备；infrastructure 层推进：frontmatter 解析器 + 任务文档仓储 + 全局文档仓储 + SQLite schema/迁移 + SQLite 索引仓储就绪。IndexRepository（src/infrastructure/sqlite/index-repo.ts）提供四张索引表的读写与全量重建——构造即 runMigrations 建表（幂等），upsertTask/upsertDecision/upsertIssue/upsertExecution 写失败经 onWarning 记告警后吞掉、不抛阻断（§3.2 容错，默认 console.warn 可注入回调），queryTasks(filter) 按 status/layer 过滤 + JSON 文本列 parse + id 数值升序、getExecution(taskId) 读最近一次执行摘要，rebuildFromDocs({taskRepo, globalRepo, decisionsDoc, issuesDoc}) 单事务清空四表后从文档全量重建（tasks/executions ← TaskDocRepository，decisions/issues ← GlobalDocRepository 解析传入的文档内容；文档损坏让错误冒泡、事务回滚保既有索引）。SQLite schema/migration（src/infrastructure/sqlite/schema.ts）提供索引表 DDL 与前向迁移入口——runMigrations(db) 对传入的 better-sqlite3 实例执行全部未应用迁移（schema_migrations 版本表为唯一事实来源，已记录版本跳过、重复调用幂等、每条迁移 db.transaction 包「up + 写版本记录」原子提交），v1 initial-schema 建 4 张表（§3.2 清单逐项对齐，DEC-010），JSON 文本列 + 表名常量导出。TaskDocRepository（同步文件系统读写）与 GlobalDocRepository（文档正文纯变换，无文件 I/O）同前。状态机 / 依赖级联 / 状态映射 / 验证 allowlist / 权限解析以纯函数提供。工具链 npm run typecheck / npm test（384 项）/ npm run lint 全绿（注：better-sqlite3 原生模块需 Node 22 ABI 127 预编译，见 ISS-005）。仍无 CLI 命令、其余 infra（git worktree、sdk、mcp）适配未实现。"
    - section: "当前架构状态"
      mode: append
      content: "src/infrastructure/sqlite/index-repo.ts 建立：依赖 sqlite/schema（runMigrations + 表名常量）+ 文档仓储（TaskDocRepository / GlobalDocRepository，只读，rebuild 用）+ core 领域类型（TaskFrontmatter/Decision/Issue/ResultFrontmatter/ReviewFrontmatter 与枚举，均 type-only import）+ 零反向依赖（不依赖 application/cli，§3.2 索引不参与状态机判定，不实现 CLI 命令——属 TASK-025）。沿用「类 + 私有直接插入 + Result 容错包装」模式：insertTask/Decision/Issue/Execution 为严格直接插入（失败抛错），public upsert* 经 tolerantWrite 包 try/catch + onWarning 吞错（§3.2 写失败不阻断），rebuildFromDocs 用直接插入（非容错 upsert*）于单一 db.transaction 内清空四表 + 重灌（原子，文档损坏回滚保既有索引）。executions 以 task_id 为主键用 INSERT OR REPLACE 覆盖重跑；depends_on/allowed_paths/permissions 写前 JSON.stringify、读后 JSON.parse；commit_* 列存 execution_commits 首条代表性 commit（DEC-010 委托本任务决定取首条，多 commit 全量索引留待后续）。查询面只暴露 queryTasks（TaskQueryFilter{status?,layer?} 动态 WHERE + JSON parse + id 数值升序）/ getExecution（无记录返回 null），decisions/issues 无公共读接口（索引用途为审计与 rebuild，人读展示走文档）。buildExecutionSummary(result, review?) 综合 .result.md + 可选 .review.md 为 ExecutionSummary（review_result 无审查为 null、commit 取首条）。readResultOptional/readReviewOptional 以 TaskDocRepository 错误前缀「文档不存在」区分「附属文档尚未产出」（跳过）与「文档损坏」（冒泡，DEC-008 稳定契约）。noUncheckedIndexedAccess 下 execution_commits[0] 用 ?? null 守卫、行访问用可选链。src/infrastructure/index.ts 经 ./sqlite/index-repo.js 再导出（NodeNext 需 .js 后缀）。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "SQLite 索引仓储复用要点（TASK-014）：IndexRepository(db, onWarning?) 构造即 runMigrations 建表（幂等），onWarning 默认 console.warn、可注入回调（测试断言容错）。upsertTask(TaskFrontmatter)/upsertDecision(Decision)/upsertIssue(Issue)/upsertExecution(ExecutionSummary) 写失败不抛（§3.2 容错）；application 层（TASK-017 状态编排）状态流转 / 合并 / 决策问题变更时调 upsert* 同步写索引（写失败仅告警不阻断流程，正确性以文档为准）。queryTasks({status?,layer?}) 返回 TaskIndexRow[]（JSON 列已 parse、id 数值升序）；getExecution(taskId) 返回 ExecutionIndexRow | null。rebuildFromDocs({taskRepo, globalRepo, decisionsDoc, issuesDoc}) 单事务清空 + 全量重建——GlobalDocRepository 是纯变换无 I/O（TASK-012 DEC-009），DECISIONS.md/ISSUES.md 内容须由调用方（CLI composition root TASK-025）读盘后传入 decisionsDoc/issuesDoc；tasks/executions 从 TaskDocRepository 重建（listTasks → readTask；readResult/readReview 不存在视为预期跳过、损坏让错误冒泡触发事务回滚）。executions 代表性 commit 取 execution_commits 首条（DEC-011）。buildExecutionSummary(result, review?) 可复用构建 ExecutionSummary。技术注记：readResultOptional/readReviewOptional 依赖 TaskDocRepository 抛错前缀「文档不存在」（DEC-008 稳定契约）区分缺失与损坏——若 TaskDocRepository 改动该错误文案，需同步更新 isDocMissing 判定。运行时原生模块约束见 ISS-005（Node 22 ABI 127）。application 层 ports（TASK-015）若定 SqliteIndexRepositoryPort，适配层 new Database + 调 runMigrations + 委托读写（结构类型兼容，本类无需 implements）。"
    - section: "当前未解决问题摘要"
      mode: replace
      content: "TASK-014 无新 issue：仅 type-only import 既有 core 类型 + 复用 sqlite/schema 与文档仓储，未新增 npm 依赖，未触及 core/application/cli，无边界冲突。IndexRepository 设计（写入容错 onWarning / rebuild 单事务原子 + 文档损坏冒泡 / DocSources 由调用方传入全局文档内容 / 代表性 commit 取首条 / 查询面仅 queryTasks+getExecution）系 §3.2/§8/§11 的合理落地（DEC-011 proposed），非规格偏离。ISS-005（low，open）延续：better-sqlite3@11.10.0 无 Node 25（ABI 141）预编译；本任务用 Node 22（ABI 127）全绿验证，TASK-014 及后续依赖 SQLite 的 CLI 任务同样受此约束。ISS-004（low，open）延续：VerificationResultSchema 暂置于 result-schema.ts；本任务未引用该枚举，ISS-004 维持现状不阻塞后续。ISS-001 / ISS-002 / ISS-003 已于 2026-07-08 全部裁定解决。"
    - section: "建议下一个任务"
      mode: replace
      content: "TASK-015：application 层 ports + context-pack-generator（layer: domain，depends_on TASK-009/011/012 均已完成）。落地 src/application/ports.ts 窄接口（TaskDocRepositoryPort / GlobalDocRepositoryPort / WorktreePort / GitMergePort，ARCHITECTURE.md §4）与 context-pack 生成用例，开启 application 层。其余已解锁的 infra 任务（TASK-018 git worktree、TASK-022 claude sdk adapter）亦可并行推进。"
  decisions:
    - id: ""
      title: "IndexRepository 设计：写入容错 onWarning 吞错不阻断、rebuild 单事务原子 + 文档损坏冒泡、DocSources 由调用方传入全局文档内容、代表性 commit 取首条、查询面仅 queryTasks+getExecution"
      status: proposed
      scope: "infrastructure/sqlite"
      created_from_task: TASK-014
      decision: "TASK-014 对 §2/§3.2/§8/§11 未明文的索引仓储设计作如下解释并落地：（1）写入容错——upsertTask/upsertDecision/upsertIssue/upsertExecution 写失败经构造注入的 onWarning 回调记告警后吞掉、不向上抛阻断（§3.2「索引写入失败不阻断状态流转和合并」）；onWarning 默认 console.warn，可注入自定义回调便于测试断言（容错测试以「关闭 db 连接」可控注入失败，§12）。内部拆「严格直接插入 insertXxx（失败抛错）」+「容错包装 tolerantWrite（try/catch + onWarning）」，rebuild 复用 insertXxx 但不经 tolerantWrite。（2）rebuild 原子性——rebuildFromDocs 在单一 db.transaction 内「清空四表 + 逐条 INSERT」，任一步抛错整体回滚、索引保持重建前状态；rebuild 用直接插入而非容错 upsert*：rebuild 是显式修复命令，文档自身损坏应让错误显式冒泡由调用方处理，不静默丢行（否则索引 ≠ 文档违反 §11）；result/review 附属文档不存在属预期（任务尚未执行/未审查）跳过该任务 execution，文档存在但损坏（Zod 校验失败等）让错误冒泡触发回滚。（3）DocSources 由调用方传入全局文档内容——rebuildFromDocs({taskRepo, globalRepo, decisionsDoc, issuesDoc})：GlobalDocRepository 是纯字符串变换、无文件 I/O（TASK-012 DEC-009），任务 §6 禁止修改 global-doc-repo.ts 加文件读取方法，故 DECISIONS.md/ISSUES.md 内容须由调用方（CLI composition root，TASK-025）读盘后传入；tasks/executions 仍经 TaskDocRepository（listTasks→readTask/readResult/readReview）。任务 §2 提示的 {taskRepo, globalRepo} 签名不足以获取全局文档内容，故扩展为含 decisionsDoc/issuesDoc 的 DocSources（不越界、不改规格）。（4）代表性 commit 取首条——executions 的 commit_hash/message/author/time 单值列存 execution_commits 首条（DEC-010 委托 TASK-014 决定取首条/最新条，本任务取首条作主实现 commit，多 commit 全量索引留待后续需要时新增 execution_commits 表 + 迁移）。（5）查询面仅 queryTasks({status?,layer?}) + getExecution(taskId)——任务 §2 明示这两个；decisions/issues 无公共读接口：索引用途为审计与 rebuild，其人读展示走 DECISIONS.md/ISSUES.md 文档本身（测试以原始 SQL 校验 rebuild 产物）。（6）queryTasks 按 id 数值升序（与 TaskDocRepository.listTasks 一致，鲁棒于补零）。（7）readResultOptional/readReviewOptional 以 TaskDocRepository 错误前缀「文档不存在」区分「附属文档尚未产出」与「文档损坏」（DEC-008 稳定契约）。"
      rationale: "§3.2 明文「索引写入失败不阻断、可 rebuild-index 全量重建、正确性以文档为准」——upsert* 容错吞错 + rebuild 全量重建是直接落地；onWarning 可注入让容错可测试（关闭 db 连接是最干净的可控失败注入，§12）。rebuild 原子性：清空 + 重灌不在事务内则中途崩溃会留半空索引（比重建前更糟），单事务保证 all-or-nothing；用直接插入而非容错 upsert* 是因为 rebuild 是显式修复、不应静默丢行（容错语义服务运行期状态流转，不服务修复命令）。DocSources 传入文档内容是架构约束的直接推论：GlobalDocRepository 经 DEC-009 设计为纯变换无 I/O（合并编排归 application TASK-020），本任务 forbidden 含 global-doc-repo.ts 不能加读方法，故全局文档内容只能由上层传入；这与 TaskDocRepository 同步 I/O（可被 index-repo 直接调）不对称，但源于两仓储设计分工不同，非缺陷。代表性 commit 取首条：execution_commits 通常按时间序、首条是主实现 commit；取首条/最新条均可（DEC-010 明示），取首条简单且语义清晰。查询面仅 tasks+executions：§3.2 索引主要查询场景是任务状态/依赖与执行摘要（status 命令、依赖索引、恢复加速），decisions/issues 的索引行用于审计与 rebuild、人读展示走文档——故不为它们建公共读接口，避免提前实现后续 CLI 逻辑（AGENTS §4）。id 数值升序与 listTasks 一致避免排序语义漂移。错误前缀区分缺失/损坏：TaskDocRepository 对文件不存在与校验失败抛不同前缀的 Error（DEC-008 稳定契约），rebuild 据此跳过「尚未产出」的附属文档、对损坏文档冒泡——是 forbidden 约束下（不能改文档仓储加 exists 方法）的最干净方案。"
      consequences: "application 层（TASK-015 ports / TASK-017 编排）调用本仓储：状态流转 / 合并 / 决策问题变更时调 upsert* 同步写索引（写失败仅告警不阻断），调 queryTasks/getExecution 做 status 查询与依赖索引；调 rebuildFromDocs 做全量重建（须先读盘 DECISIONS.md/ISSUES.md 传入 decisionsDoc/issuesDoc）。CLI rebuild-index（TASK-025）在 composition root 处 new Database(filePath) + new IndexRepository(db) + 读盘全局文档 + 调 rebuildFromDocs。若 Orchestrator 认为：(a) decisions/issues 应有公共读接口（如 listDecisions/listIssues 供 status 命令展示）——加 3 行方法 + 对应测试（届时同步改 DEC-011）；(b) 代表性 commit 应取最新条而非首条——改 buildExecutionSummary 的 execution_commits[0] 为 [length-1]（届时同步改测试）；(c) rebuild 应对损坏文档容错跳过而非冒泡——在 rebuildTasksAndExecutions 包 try/catch + onWarning（但会掩盖文档损坏，与 §11「索引=文档全集」张力，不推荐）；(d) readResultOptional 的错误前缀判定应改为更稳的机制——需先给 TaskDocRepository 加 exists 方法（扩权改 global-doc-repo/task-doc-repo，违反本任务 forbidden）或用错误子类（改 DEC-008）；(e) upsert* 容错应抛特定非阻断错误而非纯吞——改 tolerantWrite 返回 Result（当前纯吞 + onWarning，最贴合 §3.2「不阻断」）。运行时原生模块约束见 ISS-005。新增索引列 / 多 commit 全量索引：按 DEC-010 追加迁移 v2。application 层 ports（TASK-015）若定 SqliteIndexRepositoryPort，适配层创建 Database + 调 runMigrations + 委托读写（结构类型兼容，本类无需 implements）。"
      created_from_task: TASK-014
  issues: []
next_action: review
---

# TASK-014 执行结果

## 1. 执行结论

任务完成。在 `src/infrastructure/sqlite/index-repo.ts` 落地 `IndexRepository`：构造即 `runMigrations` 建表（幂等）；`upsertTask/Decision/Issue/Execution` 写失败经 `onWarning` 记告警后吞掉、不抛阻断（§3.2 容错）；`queryTasks(filter)` / `getExecution(taskId)` 查询；`rebuildFromDocs` 在单一事务内清空四表后从文档全量重建（原子，文档损坏回滚保既有索引）。`src/infrastructure/index.ts` 经 `./sqlite/index-repo.js` 再导出。`test/infrastructure/sqlite/index-repo.test.ts` 24 项集成单测覆盖 upsert/query round-trip、过滤、execution 摘要、写入容错（关闭 db 可控注入失败）、buildExecutionSummary、rebuild 全量重建 / 清空旧行 / result 无 review / 空文档 / 原子回滚。typecheck / test / lint 三项全绿，全量回归 384 项不受影响。

## 2. 完成内容

- `IndexRepository(db, onWarning?)`：
  - 构造调 `runMigrations(db)` 建表（幂等）；`onWarning` 默认 `console.warn`，可注入。
  - `upsertTask(TaskFrontmatter)` / `upsertDecision(Decision)` / `upsertIssue(Issue)` / `upsertExecution(ExecutionSummary)`：写入容错，失败经 `onWarning` 记告警不抛（§3.2）。
  - `queryTasks(filter?)`：`{status?, layer?}` 动态 WHERE，JSON 文本列 parse，id 数值升序。
  - `getExecution(taskId)`：返回 `ExecutionIndexRow | null`。
  - `rebuildFromDocs({taskRepo, globalRepo, decisionsDoc, issuesDoc})`：单事务清空四表 + 全量重建。
- 内部拆分：`insertTask/Decision/Issue/Execution`（严格直接插入）+ `tolerantWrite`（容错包装）；rebuild 复用 insert* 于事务内。
- 模块级导出：`buildExecutionSummary(result, review?)`、行类型（`TaskIndexRow` / `DecisionIndexRow` / `IssueIndexRow` / `ExecutionIndexRow` / `ExecutionSummary`）、`TaskQueryFilter` / `DocSources`。
- 单测 24 项：upsert+query round-trip（JSON 列 parse / INSERT OR REPLACE 不累积 / 数值升序）、queryTasks 过滤（status / layer / 组合 / 空）、execution 摘要（round-trip / 无记录 null / 可空列 / 重写覆盖）、decision/issue 写入（直接 SQL 校验）、写入容错（关闭 db 不抛 + onWarning 触发 / 四 upsert 均不抛 / 默认 onWarning）、buildExecutionSummary（首条 commit / 无 commit null / 无 review null）、rebuild（全量恢复四表 / 清空旧行 / result 无 review / 空文档 / 原子回滚）。

## 3. 修改文件

- `src/infrastructure/index.ts` —— 在 `./sqlite/schema.js` 导出后追加 `export * from './sqlite/index-repo.js'`，注释「TASK-014：SQLite 索引仓储（upsert / query / rebuildFromDocs，写入容错不阻断）」对齐。

## 4. 新增文件

- `src/infrastructure/sqlite/index-repo.ts` —— SQLite 索引仓储（四表读写 + 全量重建，§3.2）。
- `test/infrastructure/sqlite/index-repo.test.ts` —— upsert/query/容错/rebuild 集成测试（24 用例，内存 SQLite + 临时目录）。

## 5. 删除文件

暂无。

## 6. 架构决策

见 frontmatter `global_update_requests.decisions`（DEC-011）：写入容错（onWarning 吞错不阻断）、rebuild 单事务原子 + 文档损坏冒泡、DocSources 由调用方传入全局文档内容（GlobalDocRepository 纯变换无 I/O + forbidden 不能改）、代表性 commit 取首条、查询面仅 queryTasks+getExecution、queryTasks 数值升序、readResultOptional 错误前缀区分缺失/损坏。该决策为 Task Executor 提议（status: proposed），待 Orchestrator 回写确认。

## 7. 偏离计划

一处需说明的签名扩展（已在 DEC-011 记录，非规格偏离）：任务 §2 提示 `rebuildFromDocs({ taskRepo, globalRepo })`，但 `GlobalDocRepository` 是纯字符串变换、无文件 I/O（TASK-012 DEC-009），任务 §6 禁止修改 `global-doc-repo.ts` 加文件读取方法，故该签名不足以获取 DECISIONS.md/ISSUES.md 内容。本任务将签名扩展为 `rebuildFromDocs({ taskRepo, globalRepo, decisionsDoc, issuesDoc })`，由调用方读盘后传入全局文档内容，用 `globalRepo.readDecisions/readIssues` 解析。这是架构约束的直接推论，不越界、不改规格、不新增依赖。其余 §2 要求（四 upsert + queryTasks + getExecution + rebuildFromDocs）与 §11 验收（upsert 后可 query、写失败不抛记日志、rebuild 后索引 = 文档全集、typecheck 0 错误）逐条落地有用例覆盖。

## 8. 后续任务注意事项

- `IndexRepository(db, onWarning?)` 构造即 `runMigrations` 建表（幂等可重复）；`onWarning` 默认 `console.warn`、可注入（测试断言容错）。
- `upsert*` 写失败不抛（§3.2）；application 层（TASK-017）状态流转 / 合并 / 决策问题变更时调 upsert* 同步写索引。
- `rebuildFromDocs({taskRepo, globalRepo, decisionsDoc, issuesDoc})`：调用方须读盘 DECISIONS.md/ISSUES.md 传入；tasks/executions 从 TaskDocRepository 重建。
- `readResultOptional/readReviewOptional` 依赖 TaskDocRepository 抛错前缀「文档不存在」（DEC-008 稳定契约）区分缺失（跳过）与损坏（冒泡）——若该错误文案改动需同步更新 `isDocMissing`。
- 查询面仅 `queryTasks` / `getExecution`；decisions/issues 无公共读接口（审计/rebuild 用，人读展示走文档）。
- 代表性 commit 取 `execution_commits` 首条（DEC-011）。
- **运行时约束**（ISS-005）：better-sqlite3@11.10.0 需 Node 22（ABI 127）；CLI rebuild-index（TASK-025）同样受此约束。
- application 层 ports（TASK-015）若定异步接口，适配层包 `Promise` 即可（结构类型兼容，本类无需 `implements`）。

## 9. 未解决问题

无新 issue。IndexRepository 设计（DEC-011 proposed）系 §3.2/§8/§11 的合理落地，无边界冲突、无新增依赖、未触及 core/application/cli。ISS-005（better-sqlite3 Node 版本兼容）延续：本任务用 Node 22（ABI 127）全绿验证。ISS-004（VerificationResultSchema 位置）不阻塞本任务——本任务未引用该枚举。

## 10. 验证结果

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run typecheck` | passed | `tsc --noEmit` 0 错误（Node v22.0.0） |
| `npm test -- infrastructure/sqlite/index-repo` | passed | vitest 1 文件 24 用例全通过（内存 SQLite + 临时目录） |
| `npm run lint` | passed | ESLint src/test 无 error/warning |
| `npm test`（全量回归） | passed | 13 文件 384 用例全通过（含新增 24 项） |

## 11. 人工验收建议

- 复核写入容错（§11）：关闭 db 连接后 `upsertTask` 不抛、注入的 `onWarning` 被调用（见「写入容错」测试组）。
- 复核 rebuild 全量重建（§11）：rebuild 后 `queryTasks` / `getExecution` / 直接 SQL 查 decisions+issues 与文档全集逐项相等（见「rebuildFromDocs 全量重建」测试组）。
- 复核 rebuild 原子性：文档损坏（result frontmatter 非法枚举）时 `rebuildFromDocs` 抛错、既有索引行经事务回滚保留（见「rebuild 原子性」测试）。
- 复核 DocSources 签名扩展合理性（DEC-011）：`GlobalDocRepository` 纯变换无 I/O + forbidden 不改 global-doc-repo.ts → 全局文档内容由调用方传入。
- 复核代表性 commit 取首条（DEC-011）：`buildExecutionSummary` 取 `execution_commits[0]`。
- 确认 DEC-011 索引仓储设计（容错 onWarning / rebuild 单事务原子 + 文档损坏冒泡 / DocSources / 代表性 commit 首条 / 查询面仅 tasks+executions）是否符合 §3.2/§8/§11。
- 确认 ISS-005 处理方向（固定 Node 22 / 升级 better-sqlite3 / 预装编译工具链）。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（6 个 section：完成进度 append、能力 replace、架构 append、后续须知 append、未解决问题 replace、下一任务 replace）、decisions（1 条 proposed：DEC-011 IndexRepository 设计）、issues（无新增，ISS-005 延续）。由 Orchestrator 在合并回 main 后统一回写 `docs/PROGRESS.md` / `docs/DECISIONS.md` / `docs/ISSUES.md`。
