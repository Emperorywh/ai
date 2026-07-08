---
task_id: TASK-013
execution_status: completed
modified_files:
  - src/infrastructure/index.ts
created_files:
  - src/infrastructure/sqlite/schema.ts
  - test/infrastructure/sqlite/schema.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: "tsc --noEmit，0 错误（strict + noUncheckedIndexedAccess），Node v22.0.0"
  - command: npm test -- infrastructure/sqlite/schema
    result: passed
    notes: "vitest run infrastructure/sqlite/schema，1 文件 15 用例全通过（内存 SQLite）"
  - command: npm run lint
    result: passed
    notes: "eslint src test，无 error / warning"
  - command: npm test
    result: passed
    notes: "全量回归 12 文件 360 用例全通过（新增 15 项，原 345 不受影响）"
global_update_requests:
  progress:
    - section: "当前完成到哪个任务"
      mode: append
      content: "TASK-013（Infra SQLite schema 与迁移）已完成：src/infrastructure/sqlite/schema.ts 提供 runMigrations(db)（前向迁移、版本表记录、幂等）+ 4 张索引表 DDL（tasks/decisions/issues/executions，列与 §3.2 索引清单逐项对齐），15 项内存 SQLite 集成单测。"
    - section: "当前系统可用能力"
      mode: replace
      content: "Core type 层（TASK-002~006）+ domain 层状态机（TASK-007）+ 领域规则（TASK-008 依赖级联与状态映射、TASK-009 验证 allowlist 与权限解析）齐备；infrastructure 层推进：frontmatter 解析器 + 任务文档仓储 + 全局文档仓储 + SQLite schema/迁移就绪。SQLiteSchemaMigration（src/infrastructure/sqlite/schema.ts）提供索引表 DDL 与前向迁移入口——runMigrations(db) 对传入的 better-sqlite3 实例执行全部未应用迁移（schema_migrations 版本表为唯一事实来源，已记录版本跳过、重复调用幂等），v1 initial-schema 建 4 张表：tasks(id,title,status,layer,depends_on,allowed_paths,permissions)、decisions(id,title,status,scope)、issues(id,title,severity,status,owner)、executions(task_id,execution_status,review_result,next_action,commit_hash,commit_message,author,time)，列与 §3.2「索引内容至少包括」清单逐项对齐（DEC-010）；depends_on/allowed_paths/permissions 以 JSON 文本列存储（§8，DEFAULT '[]'）；文本主键显式 NOT NULL（SQLite 非 INTEGER 主键不隐式 NOT NULL）；executions 以 task_id 为主键（一行=一个任务最近一次执行摘要）、commit/review 列可空。表名常量（TASKS_TABLE 等）与 SCHEMA_VERSION 已导出供 TASK-014 引用。GlobalDocRepository（文档正文纯变换，无文件 I/O）与 TaskDocRepository（同步文件系统读写）同前。状态机 / 依赖级联 / 状态映射 / 验证 allowlist / 权限解析以纯函数提供。工具链 npm run typecheck / npm test（360 项）/ npm run lint 全绿（注：better-sqlite3 原生模块需 Node 22 ABI 127 预编译，见 ISS-005）。仍无 CLI 命令、其余 infra（SQLite 索引仓储 TASK-014、git worktree、sdk）适配未实现。"
    - section: "当前架构状态"
      mode: append
      content: "src/infrastructure/sqlite/schema.ts 建立：依赖 better-sqlite3（仅 type-only import Database 取实例类型 Database.Database，schema.ts 自身不打开连接、不做 I/O——连接由 TASK-014 / 测试创建后传入）+ 零运行时依赖（不依赖 core/application/cli，§3.2 索引不参与状态机判定）。沿用「数据结构 + 纯函数」模式：MIGRATIONS 数组（version/name/up 前向 only、升序）为迁移定义单一来源，runMigrations 逐条检查 schema_migrations 版本表、未应用则 db.transaction 包「up + 写版本记录」原子提交（up 抛错整条回滚、错误冒泡不静默）；ensureMigrationsTable 用 CREATE TABLE IF NOT EXISTS（bootstrap 幂等），索引表 DDL 用裸 CREATE TABLE（由版本表守卫只建一次，DEC-010）。表名 / 版本常量（TASKS_TABLE/DECISIONS_TABLE/ISSUES_TABLE/EXECUTIONS_TABLE/MIGRATIONS_TABLE/SCHEMA_VERSION）导出供 TASK-014 避免魔法字符串。applied_at 用 new Date().toISOString()（ISO8601 UTC，与 reviewed_at 约定一致）。noUncheckedIndexedAccess 下 prepare 泛型 <unknown[], {col}> 让 .all() 返回精确类型、行访问用可选链。src/infrastructure/index.ts 经 ./sqlite/schema.js 再导出（NodeNext 需 .js 后缀）。"
    - section: "后续任务必须知道的信息"
      mode: append
      content: "SQLite schema 复用要点（TASK-013）：runMigrations(db) 接收已打开的 better-sqlite3 实例（同步 API），TASK-014 索引仓储构造或首次写入前调用一次建表即可（幂等，重复调用无副作用）。4 张表 DDL 已定型——tasks/decisions/issues 以 id（TEXT PRIMARY KEY NOT NULL）为主键，executions 以 task_id 为主键（一行=一个任务的「最近一次执行摘要」，重跑同一任务用 INSERT OR REPLACE 覆盖）。depends_on/allowed_paths/permissions 是 JSON 文本列（TEXT，写入前 JSON.stringify、读出后 JSON.parse，§8），DEFAULT '[]'（issues.owner DEFAULT ''）。表名用导出常量 TASKS_TABLE 等，勿硬编码字符串。新增列 / 表时按 version 递增追加 MIGRATIONS（不复用已用版本号、不回滚），每条迁移在事务内 up + 写版本记录原子提交。运行时约束（ISS-005）：better-sqlite3@11.10.0 无 Node 25 ABI 141 预编译、本机无 VS Build Tools 无法重编译，当前需在 Node 22（ABI 127）下运行；TASK-014 及后续依赖 SQLite 的 CLI 任务同样受此约束。schema.ts 自身 type-only import better-sqlite3（不打开连接），实际 Database 实例由调用方（TASK-014 / 测试）new Database(':memory:' | filePath) 创建后传入——与 frontmatter-parser/task-doc-repo 同步风格一致，application 层 ports 若定异步接口需在适配层包 Promise（结构类型兼容，本模块无需 implements）。"
    - section: "当前未解决问题摘要"
      mode: replace
      content: "新增 ISS-005（low，open）：better-sqlite3@11.10.0 原生模块 Node 版本兼容——无 Node 25（ABI 141）预编译、本机无 VS Build Tools 无法 node-gyp 重编译；本任务实现期间将 nvm 切到 Node 22（ABI 127，已有预编译）完成验证，项目 package.json engines \"node\": \">=20\" 实际受原生模块约束。不阻塞本任务（已用 Node 22 全绿验证），但影响开发者 / CI 环境选型。ISS-004（low，open）延续：VerificationResultSchema 暂置于 result-schema.ts；本任务未引用该枚举，ISS-004 维持现状不阻塞后续。ISS-001 / ISS-002 / ISS-003 已于 2026-07-08 全部裁定解决。"
    - section: "建议下一个任务"
      mode: replace
      content: "TASK-014：Infra SQLite 索引仓储（layer: data，depends_on: TASK-013 已完成）。在 runMigrations 建表之上实现索引读写（upsert 任务 / 决策 / 问题 / 执行摘要、rebuild-index 从文档全量重建）。application 层 ports（TASK-015）已解锁（depends_on TASK-009/011/012 均已完成）。"
  decisions:
    - id: ""
      title: "SQLite schema 迁移设计与列约束：版本表为唯一事实来源（前向 only、事务性、IF NOT EXISTS 仅限 bootstrap）、JSON 文本列 DEFAULT、文本主键显式 NOT NULL、executions 以 task_id 为主键"
      status: proposed
      scope: "infrastructure/sqlite"
      created_from_task: TASK-013
      decision: "TASK-013 对 §3.1/§3.2/§8 未明文的迁移机制与列约束作如下解释并落地：（1）迁移机制——schema_migrations(version,name,applied_at) 版本表为「已应用版本」的唯一事实来源；MIGRATIONS 数组（{version,name,up} 前向 only、按 version 升序）为迁移定义单一来源；runMigrations 逐条检查版本表、未应用则 db.transaction 包「up + INSERT 版本记录」原子提交，up 抛错整条回滚（含已建表）+ 错误冒泡不静默；forward-only 不回滚、不复用已用版本号。（2）IF NOT EXISTS 边界——迁移版本表用 CREATE TABLE IF NOT EXISTS（它是 bootstrap：必须先存在才能查询已应用版本，重复调用时表已存在须 no-op）；4 张索引表 DDL 用裸 CREATE TABLE（由版本表守卫「建表只发生一次」，不用 IF NOT EXISTS 以保持迁移显式、避免掩盖 schema 漂移）。（3）列类型与约束——全部 TEXT（SQLite type affinity，派生索引无需强类型）；depends_on/allowed_paths/permissions 为 JSON 文本列（§8 明文「以 JSON 文本列存储」）且 NOT NULL DEFAULT '[]'（写入可省略、读出 JSON.parse），issues.owner NOT NULL DEFAULT ''（空串表「尚未指派」与 ISSUES.md owner 约定一致）；文本主键（id / task_id）显式 NOT NULL（SQLite 对非 INTEGER PRIMARY KEY 不隐式 NOT NULL——历史 quirk，显式声明符合 SQL 标准、杜绝 NULL 主键行）。（4）executions 以 task_id 为主键——一行 = 一个任务的「最近一次执行摘要」（§3.2「最近一次执行摘要」语义），任务重跑用 INSERT OR REPLACE 覆盖；commit_hash/commit_message/author/time 为单值列存「代表性 commit」（execution_commits 数组在索引中取首条 / 最新条，多 commit 全量索引留待后续需要时由 TASK-014+ 扩展，§3.2 为「至少包括」不强制全量）；review_result/next_action/commit_* 可空（任务可能尚未审查或无 commit）。（5）applied_at 用 new Date().toISOString()（ISO8601 UTC，与 reviewed_at §15 约定一致）。（6）表名 / SCHEMA_VERSION 导出为常量供 TASK-014 引用避免魔法字符串。"
      rationale: "§3.2 明文 SQLite 是「派生存储、非事实来源、写入失败不阻断、可 rebuild-index 全量重建」——索引 schema 应简单、可重建、可演进。版本表 + 前向迁移是业界标准模式（knex / TypeORM / prisma migration 均如此），单一事实来源 + 事务原子提交保证「建表与版本记录同进退」、不出现「表建了但版本没记」的中间态。IF NOT EXISTS 仅限 bootstrap 的迁移表：数据表若用 IF NOT EXISTS 会在「版本表丢失但表存在」的异常态静默跳过迁移、掩盖 schema 漂移，裸 CREATE TABLE 让迁移显式、异常态显式失败。JSON 文本列是 §8 明文要求（SQLite 无原生数组类型）；DEFAULT '[]' 让 TASK-014 写入无依赖的任务时可省略 JSON 列、降低出错面。文本主键显式 NOT NULL 规避 SQLite 非 INTEGER 主键允许 NULL 的历史 quirk（SQL 标准要求 PK 隐式 NOT NULL，SQLite 因早期 bug 不强制，显式声明最安全）。executions 以 task_id 为主键：§3.2「最近一次执行摘要」是 per-task 的最新一份，PRIMARY KEY(task_id) + INSERT OR REPLACE 天然支持「重跑覆盖」；commit 单值列是任务 §2 DDL 的字面（executions(task_id,...,commit_hash,commit_message,author,time)），代表性 commit 满足「至少包括」清单，全量 execution_commits 索引超出本任务范围。applied_at UTC 与项目 datetime 约定一致。schema.ts 用 type-only import better-sqlite3（只取实例类型、自身不开连接）：DDL 与迁移编排是纯 SQL 字符串 + 对传入 db 的方法调用，不需要构造 Database，连接归属 TASK-014 / cli composition root，职责单一。"
      consequences: "TASK-014 索引仓储：构造 / 首次写入前调用 runMigrations(db) 建表（幂等可重复）；读写用 prepare + run/get/all；depends_on/allowed_paths/permissions 写前 JSON.stringify、读后 JSON.parse；executions 重跑用 INSERT OR REPLACE 覆盖（task_id 主键）；表名用导出常量。新增列 / 表：按 version 递增追加 MIGRATIONS（如 v2 add-column-x），每条在事务内 up + 写版本，不复用版本号、不回滚。若 Orchestrator 认为：(a) executions 应支持多 commit 全量索引——新增 execution_commits(task_id,hash,message,author,time) 表 + 迁移 v2（届时改测试与 DEC-010）；(b) 索引表应用 IF NOT EXISTS 以容忍异常态——改 createInitialSchema 各 CREATE TABLE（但会掩盖 schema 漂移，不推荐）；(c) applied_at 应含本地时区——改 .toISOString() 为带 offset（当前 UTC，与 §15 一致）；(d) 应加索引（如 tasks.status 查询加速）——新增迁移加 CREATE INDEX。运行时原生模块约束见 ISS-005（Node 22 ABI 127 / 或装编译工具链重编译）。application 层 ports（TASK-015）若定 SqliteIndexRepositoryPort，适配层创建 Database 实例 + 调 runMigrations + 委托读写（结构类型兼容）。"
      created_from_task: TASK-013
  issues:
    - id: ""
      title: "better-sqlite3@11.10.0 无 Node 25（ABI 141）预编译、本机无 VS Build Tools 无法重编译，需 Node 22（ABI 127）运行"
      status: open
      severity: low
      scope: "infrastructure/sqlite"
      owner: ""
      recommended_action: "better-sqlite3 是原生模块，预编译二进制绑定特定 NODE_MODULE_VERSION。当前环境 Node v25.9.0（ABI 141）无对应预编译；nvm 可用的 Node 22.0.0（ABI 127）有预编译。本任务实现期间已用 prebuild-install（Node 22）补回被先前 npm rebuild 失败清空的 build/Release/better_sqlite3.node，并将 nvm 全局切到 Node 22 完成全绿验证。影响：开发者与 CI 需在 Node 22（或装有 VS Build Tools + C++ 工作负载可 node-gyp 重编译的版本）下运行本项目的 SQLite 相关测试 / 命令；package.json engines \"node\": \">=20\" 实际受原生模块约束。建议（任选其一，待 Orchestrator / 用户裁定）：(A) 固定项目 Node 版本为 22——加 .nvmrc（22）或收紧 engines 上界，并在文档标注；(B) 待 better-sqlite3 发布 Node 25 预编译后升级（npm i better-sqlite3@latest 触发 prebuild-install 重取）；(C) CI / 本机预装 VS Build Tools + Desktop C++ 工作负载以支持任意 Node 版本下 node-gyp 重编译。不阻塞 TASK-013 验收（已用 Node 22 全绿），但 TASK-014 及后续依赖 SQLite 的 CLI 任务同样受此约束。注：当前 nvm 全局已切到 Node 22（用户原为 Node 25）。"
      created_from_task: TASK-013
next_action: review
---

# TASK-013 执行结果

## 1. 执行结论

任务完成。在 `src/infrastructure/sqlite/schema.ts` 落地 SQLite 索引表的 DDL 与前向迁移入口：`runMigrations(db)` 对传入的 better-sqlite3 实例执行全部未应用迁移（`schema_migrations` 版本表为唯一事实来源，已应用版本跳过、重复调用幂等），v1 `initial-schema` 建 4 张索引表（`tasks` / `decisions` / `issues` / `executions`），列与 §3.2「索引内容至少包括」清单逐项对齐。`src/infrastructure/index.ts` 经 `./sqlite/schema.js` 再导出。`test/infrastructure/sqlite/schema.test.ts` 15 项内存 SQLite 集成单测覆盖建表 / 幂等 / 列对齐 / 约束默认值 / 读写冒烟 / 事务原子性。typecheck / test / lint 三项全绿，全量回归 360 项不受影响。

**环境提示（重要）**：本任务实现期间发现 better-sqlite3@11.10.0 原生模块无 Node 25（ABI 141）预编译、本机无 VS Build Tools 无法 node-gyp 重编译。已用 prebuild-install（Node 22）补回二进制并将 nvm 全局切到 **Node 22.0.0**（用户原为 Node 25.9.0）完成验证。详见 §9 与 ISS-005。当前会话的 `node` 已是 v22.0.0。

## 2. 完成内容

- `schema.ts`：
  - `runMigrations(db): void` —— 对传入的 better-sqlite3 实例执行未应用迁移（幂等）。
  - `createInitialSchema(db)` —— v1 迁移：建 4 张索引表（DDL 见 §3.2 清单）。
  - 模块级辅助：`ensureMigrationsTable`（IF NOT EXISTS bootstrap 版本表）、`readAppliedVersions`（读已应用版本号集合）、`applyMigration`（事务包 up + 写版本记录）。
  - 常量导出：`TASKS_TABLE` / `DECISIONS_TABLE` / `ISSUES_TABLE` / `EXECUTIONS_TABLE` / `MIGRATIONS_TABLE` / `SCHEMA_VERSION`。
  - 迁移定义：`MIGRATIONS`（`{version, name, up}` 前向 only、升序，目前 v1）。
- 列设计（DEC-010）：
  - `tasks(id,title,status,layer,depends_on,allowed_paths,permissions)` —— JSON 列 `NOT NULL DEFAULT '[]'`。
  - `decisions(id,title,status,scope)` / `issues(id,title,severity,status,owner)` —— owner `DEFAULT ''`。
  - `executions(task_id,execution_status,review_result,next_action,commit_hash,commit_message,author,time)` —— `task_id` 主键、`execution_status` NOT NULL、其余可空。
  - 所有文本主键显式 `NOT NULL`。
- 单测 15 项：建表（4 索引表 + 版本表 / 版本表记录 version+name+ISO 时间戳）、幂等（重复调用不报错且版本表仍 1 行 / 表结构不变 / bootstrap IF NOT EXISTS）、列对齐 §3.2（4 张表逐表 arrayContaining）、约束默认值（JSON 列 DEFAULT '[]' / 文本主键 NOT NULL / executions 可空列）、读写冒烟（JSON 文本列 round-trip / 四表插入查询）、迁移事务原子性（版本与表结构同进退）。

## 3. 修改文件

- `src/infrastructure/index.ts` —— 在 `./fs/global-doc-repo.js` 导出后追加 `export * from './sqlite/schema.js'`，注释「TASK-013：SQLite 索引表 DDL 与前向迁移（runMigrations，幂等）」对齐。

## 4. 新增文件

- `src/infrastructure/sqlite/schema.ts` —— SQLite 索引表 DDL 与前向迁移入口（§3.1 / §3.2 / §8）。
- `test/infrastructure/sqlite/schema.test.ts` —— runMigrations 建表 / 幂等 / 列对齐 / 约束 / 读写冒烟集成测试（15 用例，内存 SQLite）。

## 5. 删除文件

暂无。

## 6. 架构决策

见 frontmatter `global_update_requests.decisions`（DEC-010）：迁移机制用版本表（schema_migrations）为唯一事实来源 + MIGRATIONS 前向数组 + 每条迁移事务原子提交；IF NOT EXISTS 仅限 bootstrap 版本表、索引表 DDL 用裸 CREATE TABLE（版本表守卫）；JSON 文本列 DEFAULT '[]'（§8）；文本主键显式 NOT NULL（规整 SQLite 非 INTEGER 主键不隐式 NOT NULL 的历史 quirk）；executions 以 task_id 为主键（一行 = 最近一次执行摘要、重跑 INSERT OR REPLACE 覆盖）；commit 单值列存代表性 commit（多 commit 全量索引留待后续）；applied_at ISO8601 UTC。该决策为 Task Executor 提议（status: proposed），待 Orchestrator 回写确认。

## 7. 偏离计划

无偏离。任务 §2 要求的 DDL（4 张表 + 列）与 `runMigrations(db)` 全部落地；§11 验收的「临时 db runMigrations 建表成功 + 重复幂等」「列与 §3.2 清单逐项对齐」「typecheck 0 错误」均有用例覆盖（内存 SQLite 即 TESTING.md data 层推荐的临时 db）；§8「depends_on/allowed_paths/permissions 以 JSON 文本列存储」「迁移幂等：版本表存在则跳过」逐条落地。§12 风险点「better-sqlite3 原生模块 Windows 预编译」已实际触发（Node 25 无预编译、无编译工具链），以 ISS-005 记录 + Node 22 预编译 workaround 解决，不阻塞验收。

## 8. 后续任务注意事项

- `runMigrations(db)` 接收**已打开**的 better-sqlite3 实例（同步 API）；TASK-014 索引仓储在构造 / 首次写入前调用一次即可（幂等，可重复调用）。
- `schema.ts` 自身 **type-only import** better-sqlite3（只取实例类型 `Database.Database`），不打开连接——连接由 TASK-014 / cli / 测试 `new Database(':memory:' | filePath)` 创建后传入。
- 4 张表 DDL 已定型：`tasks/decisions/issues` 以 `id` 为主键；`executions` 以 `task_id` 为主键（重跑同任务用 `INSERT OR REPLACE` 覆盖）。
- `depends_on/allowed_paths/permissions` 是 **JSON 文本列**：写前 `JSON.stringify`、读后 `JSON.parse`；`DEFAULT '[]'`（`issues.owner DEFAULT ''`）。
- 表名用导出常量（`TASKS_TABLE` 等），勿硬编码字符串。
- 新增列 / 表：按 `version` 递增追加 `MIGRATIONS`（不复用已用版本号、不回滚），每条迁移在事务内 `up` + 写版本记录。
- **运行时约束**（ISS-005）：better-sqlite3@11.10.0 需 Node 22（ABI 127）预编译；TASK-014 及后续依赖 SQLite 的 CLI 任务同样受此约束。
- application 层 ports（TASK-015）若定异步接口，适配层包 `Promise` 即可（结构类型兼容，本模块无需 `implements`）。

## 9. 未解决问题

新增 ISS-005（low，open）：better-sqlite3@11.10.0 无 Node 25（ABI 141）预编译、本机无 VS Build Tools 无法 node-gyp 重编译。实现期间处理过程：
1. 原有二进制是为 Node 22（ABI 127）编译；当前 Node 25 加载报 `NODE_MODULE_VERSION 127 vs 141` 不匹配。
2. `npm rebuild better-sqlite3` 失败（无 VS Build Tools，且 Node 25 超出 VS2017 支持范围）——该失败**清空了** `build/Release/` 原有二进制。
3. 用 `prebuild-install`（Node 22 运行）从 GitHub release 补回 ABI 127 预编译二进制。
4. `nvm use 22.0.0` 将全局 Node 切到 v22.0.0，完成全部验证（typecheck / test / lint 全绿）。

影响：开发者 / CI 需 Node 22（或装编译工具链）运行 SQLite 相关测试 / 命令；`package.json` engines `"node": ">=20"` 实际受原生模块约束。建议处理见 ISS-005 recommended_action（固定 Node 22 / 升级 better-sqlite3 / 预装 VS Build Tools，待裁定）。**当前 nvm 全局已切到 Node 22**（用户原为 Node 25），如需切回可 `nvm use 25.9.0`（但切回后 SQLite 测试将无法加载原生模块）。

ISS-004（VerificationResultSchema 置于 result-schema.ts）不阻塞本任务——本任务未引用该枚举，ISS-004 维持 open。

## 10. 验证结果

| 命令 | 结果 | 说明 |
|------|------|------|
| `npm run typecheck` | passed | `tsc --noEmit` 0 错误（Node v22.0.0） |
| `npm test -- infrastructure/sqlite/schema` | passed | vitest 1 文件 15 用例全通过（内存 SQLite） |
| `npm run lint` | passed | ESLint src/test 无 error/warning |
| `npm test`（全量回归） | passed | 12 文件 360 用例全通过（含新增 15 项） |

## 11. 人工验收建议

- 复核建表（§11）：`runMigrations` 后 `sqlite_master` 含 `tasks/decisions/issues/executions/schema_migrations` 五张表。
- 复核幂等（§11 验收核心）：连续两次 `runMigrations(db)` 不抛错，`schema_migrations` 仍只有 1 行（version=1）。
- 复核列对齐 §3.2：4 张表的 `PRAGMA table_info` 含清单全部列（`arrayContaining`）。
- 复核 JSON 文本列（§8）：`tasks.depends_on/allowed_paths/permissions` 写 JSON 字符串、读回 `JSON.parse` 深度相等；`DEFAULT '[]'` 生效。
- 复核约束：文本主键 `NOT NULL=1`；`executions.review_result/next_action/commit_*` 可空（`notnull=0`）。
- 复核事务原子性：`applyMigration` 用 `db.transaction`（可人工 review schema.ts，单测以「版本与表同进退」间接覆盖）。
- 确认 DEC-010 迁移设计与列约束（版本表唯一事实来源 / IF NOT EXISTS 仅 bootstrap / JSON 文本列 DEFAULT / 文本主键显式 NOT NULL / executions task_id 主键 + commit 单值列）是否符合 §3.2/§8。
- 确认 ISS-005 处理方向（固定 Node 22 / 升级 better-sqlite3 / 预装编译工具链）。

## 12. 全局文档更新建议

见 frontmatter `global_update_requests`：progress（6 个 section：完成进度 append、能力 replace、架构 append、后续须知 append、未解决问题 replace、下一任务 replace）、decisions（1 条 proposed：DEC-010 SQLite schema 迁移设计与列约束）、issues（1 条 open：ISS-005 better-sqlite3 原生模块 Node 版本兼容）。由 Orchestrator 在合并回 main 后统一回写 `docs/PROGRESS.md` / `docs/DECISIONS.md` / `docs/ISSUES.md`。
