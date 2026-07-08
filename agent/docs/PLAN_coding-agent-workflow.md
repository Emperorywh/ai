---
plan_id: PLAN_coding-agent-workflow
title: 自研 Coding Agent 长任务工作流系统 — 开发计划
source_spec: Readme.md
status: draft
created: 2026-07-08
owner: Orchestrator
---

# PLAN — 自研 Coding Agent 长任务工作流系统

> 本计划基于 `Readme.md`（根目录）制定。`Readme.md` 同时承担 SPEC 与 ARCHITECTURE 职责（见下文「SPEC 待确认事项」第 1 条）。本计划只做拆分与排期，不实施代码。

## 0. SPEC 待确认事项与风险（制定计划前先指出）

按需求第 5 条，以下内容在 SPEC 中**不适合直接执行 / 未确认 / 存在耦合风险**，已通过任务边界加以隔离或后置，**不阻塞**本计划，但需在对应任务中先确认再实现：

1. **`Readme.md` 是本仓库自举阶段的 `source_spec`。**
   `Readme.md` 把产品规格、架构约束、状态机、文档模板混在一起；这符合 SPEC 第 6 节定义的自举例外。本计划把它作为**权威 source_spec + architecture 来源**；TASK-001 负责生成一份薄 `docs/ARCHITECTURE.md`（落地目录结构与分层边界）并指向 `Readme.md`，以满足文档协议的「必读核心 = `AGENTS.md` + `docs/ARCHITECTURE.md` + `docs/PROGRESS.md` + 当前任务文件」要求。**不另起 `docs/SPEC.md` 重写**，避免与 `Readme.md` 漂移。该例外在任务进入 `ready` 前必须由 Reviewer 或人工确认：`Readme.md` 与本 PLAN 不存在阻塞级待确认问题。

2. **Claude Agent SDK 的具体 API 未确认（高风险）。**
   SPEC 仅声明「Claude Agent SDK 作为执行引擎适配层」，但未明确 SDK 版本、子 agent 派发、hooks、权限注入的具体接口。处理：
   - 在 `infrastructure/sdk/` 内用**接口隔离**，`core` / `application` 不得依赖具体 SDK；
   - TASK-022（SDK 适配器）后置到 P7，并先在该任务内确认 API；
   - 在 SDK 就位前，CLI 的 `task:run`（TASK-026）支持「本地 dry-run executor」以便前置阶段可独立验证。

3. **MCP 适配器无具体服务清单（范围未确认）。**
   SPEC 只说「接入外部工具能力」，未指定任何 MCP server。处理：TASK-028 仅产出**适配器骨架与注册机制**，不含具体 MCP server 业务逻辑；具体接入按需另立任务。

4. **UI（Tauri/React）显式标注「后期」。**
   不纳入本计划，后续单独立项。

5. **CLI 命令签名未在 SPEC 中固定。**
   `init / plan / task:create / task:run / task:review / status / rebuild-index` 仅列出名称。处理：各 CLI 任务（P8）负责固化入参/出参与退出码，并在 `docs/ARCHITECTURE.md` 的「CLI 边界」小节回写。

6. **合并编排跨 Git / 文档仓储 / 应用逻辑（耦合风险）。**
   SPEC 自身已把合并拆为 rebase + 回填 + fast-forward + section 回写 + 幂等恢复。本计划严格按此拆为 3 个任务（TASK-019/020/021），每个 ≤4 文件、可在临时 git 仓库内独立验证。

7. **SQLite 是派生存储，非事实来源。**
   已在 P3（TASK-013/014）明确：写入失败不阻断流程，提供 `rebuild-index` 全量重建；状态机只读 frontmatter，不读 SQLite。

8. **第三方依赖必须前置集中声明。**
   Zod、YAML、SQLite、CLI 框架等基础依赖由 TASK-001 在 `package.json` 中一次性声明并安装，后续任务默认不得临时新增依赖；若后续任务发现必须新增依赖，应阻塞并在 `.result.md` 中提出扩权/新增依赖任务建议，而不是越权修改 `package.json`。

> 结论：以上均为**可隔离的后置确认项**，不存在需要现在就推翻 SPEC 的硬阻塞。计划继续。

## 1. 技术栈与分层（来自 Readme.md §3.1）

```text
TypeScript + Node.js CLI（第一阶段主入口）
+ Claude Agent SDK（P7，接口隔离）
+ Markdown/YAML 文档协议（事实来源）
+ Zod Schema 校验（core 层）
+ SQLite 状态索引（派生存储）
+ Git worktree 任务隔离
+ MCP 工具扩展（P9，骨架）
+ 后期 Tauri/React UI（不在本计划）
```

目标源码树（TASK-001 落地，后续任务按此声明 `allowed_paths`）：

```text
agent/
  src/
    core/                       # 不依赖 cli/ui/sqlite/git/mcp/sdk
      enums.ts
      schemas/
        task-schema.ts
        decision-issue-schema.ts
        result-schema.ts
        review-schema.ts
      state-machine.ts
      rules/
        dependency-rules.ts
        status-mapping.ts
        verification-rules.ts
        permission-rules.ts
      index.ts
    application/                # 编排用例，不依赖具体基础设施实现
      ports.ts                 # application→infra 窄接口（TaskDoc/GlobalDoc/Worktree Port）
      planning-workflow.ts
      context-pack-generator.ts
      scheduler.ts
      state-orchestrator.ts
      merge/
        rebase-ff.ts
        section-writeback.ts
        recovery.ts
      index.ts
    infrastructure/             # 外部系统适配，不承载业务规则
      fs/
        frontmatter-parser.ts
        task-doc-repo.ts
        global-doc-repo.ts
      sqlite/
        schema.ts
        index-repo.ts
      git/
        worktree-adapter.ts
      sdk/
        claude-sdk-adapter.ts
        mcp/                    # 注：MCP 归 infrastructure
          mcp-adapter.ts
      index.ts
    cli/
      framework.ts
      commands/
        init.ts
        plan.ts
        task-create.ts
        status.ts
        rebuild-index.ts
        task-run.ts
        task-review.ts
      index.ts
  test/                         # 镜像 src 结构
  docs/
    PLAN_coding-agent-workflow.md
    tasks/TASK-XXX-*.md
  AGENTS.md
  Readme.md
  package.json / tsconfig.json / vitest.config.ts
```

分层依赖方向（硬约束）：`cli → application → core ← infrastructure`；`infrastructure → core`；**`core` 不反向依赖任何层**。

application→infrastructure 依赖倒置约定：application 经 `src/application/ports.ts` 中的窄接口（`TaskDocRepositoryPort`/`GlobalDocRepositoryPort`/`WorktreePort`/`GitMergePort`）依赖 infrastructure；infrastructure 提供具体实现类，由 CLI 层在 composition root 处 wiring 注入，借助 TS 结构类型兼容，infra 无需显式 `implements`。application 不得直接 import infra 实现类。`executor-contract.ts` 仍留在 `infrastructure/sdk/`，因其仅被 CLI 层（TASK-026/027）依赖、不经 application，不构成反向依赖。

`layer` 与物理分层的关系（澄清 SPEC §9）：本项目把状态机与状态编排归入 `domain`，SPEC §9 的 `state` 取值在本计划中暂不被任何任务使用（枚举仍由 TASK-002 完整定义并保留，供未来或其他项目启用），不影响验证 allowlist——`docs/TESTING.md` 的 `layers` 声明只需覆盖实际出现的 `type/domain/data/page`。

## 2. 整体阶段与任务顺序

| 阶段 | 主题 | 任务 | 依赖关键 |
|------|------|------|----------|
| P0 | 项目脚手架与基础约束 | TASK-001 | — |
| P1 | Core 领域模型与 Schema | TASK-002…009 | TASK-001 |
| P2 | Infrastructure 文件系统文档仓储 | TASK-010…012 | Core Schema |
| P3 | Infrastructure SQLite 索引 | TASK-013…014 | P2 |
| P4 | Application 编排 | TASK-015…017, TASK-029 | Core + P2 |
| P5 | Infrastructure Git worktree | TASK-018 | TASK-001 |
| P6 | Application 合并编排 | TASK-019…021 | P4 + P5 |
| P7 | Infrastructure Claude Agent SDK | TASK-022 | P4 |
| P8 | CLI 命令层 | TASK-023…027 | P2/P3/P4/P6/P7 |
| P9 | 扩展：MCP 骨架 | TASK-028 | TASK-001 |

任务清单（全局执行序）：

| ID | 标题 | layer | depends_on |
|----|------|-------|------------|
| TASK-001 | 项目脚手架与基础约束 | — | — |
| TASK-002 | Core 领域原语与枚举 | type | 001 |
| TASK-003 | Core 任务 frontmatter Schema | type | 002 |
| TASK-004 | Core 决策与问题机器字段 Schema | type | 002 |
| TASK-005 | Core 执行结果 Schema（.result.md） | type | 002,004 |
| TASK-006 | Core 审查结论 Schema（.review.md） | type | 002 |
| TASK-007 | Core 任务状态机 | domain | 002 |
| TASK-008 | Core 依赖级联与执行状态映射 | domain | 002,007 |
| TASK-009 | Core 验证 allowlist 与权限解析 | domain | 002 |
| TASK-010 | Infra frontmatter 解析器 | data | 001 |
| TASK-011 | Infra 任务/结果/审查文档仓储 | data | 003,005,006,010 |
| TASK-012 | Infra 全局文档仓储与 section 合并 | data | 004,010 |
| TASK-013 | Infra SQLite schema 与迁移 | data | 001 |
| TASK-014 | Infra SQLite 索引仓储与 rebuild-index | data | 011,012,013 |
| TASK-015 | App Context Pack 生成器 + application/ports | domain | 003,011 |
| TASK-016 | App 拓扑排序与并行检测 | domain | 003 |
| TASK-017 | App 状态流转编排器 | domain | 007,008,011,015 |
| TASK-029 | App 规划文档生成与任务拆分用例 | domain | 003,011,015,016 |
| TASK-018 | Infra Git worktree 适配器 | data | 001 |
| TASK-019 | App 合并：rebase + 回填 + fast-forward | domain | 011,015,016,018 |
| TASK-020 | App 合并：全局文档 section 回写与冲突 | domain | 012,015,016 |
| TASK-021 | App 合并：幂等恢复 | domain | 015,018,019,020 |
| TASK-022 | Infra Claude Agent SDK 适配器 | data | 009,015 |
| TASK-023 | CLI 框架与 init 命令 | page | 001 |
| TASK-024 | CLI plan 与 task:create 命令 | page | 011,015,016,029 |
| TASK-025 | CLI status 与 rebuild-index 命令 | page | 014 |
| TASK-026 | CLI task:run 命令 | page | 015,017,018,019,020,021,022 |
| TASK-027 | CLI task:review 命令 | page | 011,017,019,020,021 |
| TASK-028 | Infra MCP 适配器骨架 | data | 001 |

## 3. 依赖关系说明

- **Core（P1）是一切基础**，无任何反向依赖，必须最先完成且可被纯单元测试验证。
- **Schema 之间**：`Result` 的 `global_update_requests.decisions/issues` 复用 `Decision/Issue` 字段集 → TASK-005 依赖 TASK-004。
- **状态相关**：`status-mapping`（TASK-008）引用状态机的状态枚举 → 依赖 TASK-007。
- **文档仓储（P2）** 依赖对应 Schema（读写即校验）。
- **SQLite（P3）** 的 `rebuild-index` 必须能从文档重建 → 依赖 P2 文档仓储。
- **Application（P4）** 依赖 Core 规则 + 文档仓储；不依赖 SQLite（状态判定只读 frontmatter）。规划文档生成与任务拆分由 TASK-029 提供独立 application 用例，CLI 不直接承载该领域逻辑。
- **合并（P6）** 依赖调度（TASK-016）+ worktree/git merge 原语（TASK-018）+ 文档仓储（TASK-011/012）；内部 019→020→021 串行。017/019/020/021 均经 TASK-015 的 `ports.ts` 接口依赖 infra，同时保留对对应 infra 实现任务（011/012/018）的依赖，供 CLI 层 wiring 与端到端测试使用。
- **SDK（P7）** 依赖 Context Pack（015）+ 权限解析（009）；以接口暴露给 CLI，CLI 在 SDK 未就位时可用 dry-run executor。
- **CLI（P8）** 是集成层，依赖其所编排的全部下游服务。

## 4. 分支策略

- 主分支：`main`。
- 每个任务独立分支：`task/TASK-XXX`（与 SPEC §3.2 worktree 命名一致），从 `main` 最新基线切出。
- 合并顺序：严格按 §2 表的 `depends_on` **拓扑序**回收，先合并被依赖方。
- 合并方式：rebase 到最新 `main` → fast-forward 回收，**不产生 merge commit**（与 SPEC §3.2 一致）。
- 任务状态为 `draft`（本计划产物初始态），经人工/Orchestrator 审核确认 `allowed_paths`/`verification` 后方可置 `ready`（**本计划不写 ready**）。
- 跨任务 `allowed_paths` 不重叠是并行前提；本计划默认**串行**执行。

## 5. 验证策略

统一验证命令（写入 `package.json` scripts，TASK-001 落地）：

- `npm run typecheck` → `tsc --noEmit`（全任务必跑）。
- `npm test` → `vitest run`（全任务必跑，按需 filter）。
- `npm run lint`（TASK-001 起）。
- **不自动启动浏览器测试**（SPEC §14/§16）。

按 `layer` 的验证侧重：

| layer | 验证手段 |
|-------|----------|
| `type`（Schema） | Zod parse 正/反例单测；`typecheck` |
| `domain`（状态机/规则/编排） | 纯函数单测；`typecheck` |
| `data`（fs/sqlite/git/sdk/mcp） | 集成测试（临时目录 / 临时 git 仓库 / 内存或临时 SQLite）；`typecheck` |
| `page`（CLI） | 命令级 e2e（在临时项目目录执行 CLI，断言产物文件与退出码） |

每个任务文件第 11 节「验收标准」给出可机器判定的通过条件；Reviewer（或 `no_review` 时 Orchestrator）据该校验。

## 6. 风险控制

| 编号 | 风险 | 控制 |
|------|------|------|
| R1 | Claude Agent SDK API 未确认 | 接口隔离 + 后置 P7 + dry-run executor 兜底 |
| R2 | 合并编排复杂、易错 | 拆 3 任务 + 幂等恢复（021）+ 临时 git 仓库集成测试 |
| R3 | SQLite 与文档漂移 | 派生存储定位 + `rebuild-index` + 写失败不阻断 |
| R4 | frontmatter/Schema 漂移 | Zod 为单一来源；文档仓储读取即校验 |
| R5 | 范围蔓延 | MCP 仅骨架；UI 不纳入 |
| R6 | 并行写全局文档冲突 | section 级机器判定合并（020）+ 冲突落 `docs/ISSUES.md` |
| R7 | worktree 缺 `node_modules` 致后续 task verify 失败 | TASK-018 仅管 worktree；`task:run`（026）在 `create` 后按需复用主工作区 `node_modules` 或重装（声明 `install_dependencies`） |

## 7. 回滚 / 恢复方式

- **任务级回滚**：每任务独立分支，失败直接丢弃分支或 `git revert` 该任务的 commit；对 `main` 无副作用（未合并）。
- **Core 层**：纯函数，回滚 = 还原文件，零副作用。
- **Infrastructure SQLite**：迁移前向为主；损坏时 `rebuild-index` 从文档全量重建（TASK-014/025）。
- **合并阶段崩溃**：由 TASK-021 的幂等恢复逻辑基于 `git branch --merged` + frontmatter `status` 重建进度（与 SPEC §3.2 一致）。
- **全局文档误写**：从 git 历史恢复；任务分支在 `rejected/failed/cancelled` 前不自动清理（SPEC §3.2）。

## 8. 任务文件位置

- 计划：`docs/PLAN_coding-agent-workflow.md`（本文件）
- 任务：`docs/tasks/TASK-XXX-*.md`（共 29 个，初始状态均为 `draft`）

## 9. 收尾标准（所有任务 done 后）

- `npm run typecheck && npm test && npm run lint` 全量通过。
- CLI 7 个命令均可端到端跑通（init→plan→task:create→task:run→task:review→status→rebuild-index）。
- `Readme.md` 中 §19「成功标准」逐条具备对应实现或文档依据。
- 由 Orchestrator/人工决定是否打 tag / 发版。
