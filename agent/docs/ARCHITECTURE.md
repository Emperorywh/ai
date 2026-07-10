---
doc: ARCHITECTURE
source_spec: Readme.md
status: bootstrap-thin
---

# ARCHITECTURE — 架构约束（薄封装）

> **权威来源声明**：本仓库处于自举阶段（`Readme.md` §6 自举例外）。根目录 `Readme.md` 是**权威的 source_spec + architecture 来源**——它同时承载产品规格、架构约束、状态机与文档模板。本文件只做**薄封装**：落地目录结构与分层约定，细节一律回指 `Readme.md` 对应章节，**不另起 `docs/SPEC.md` 重写**，避免与 `Readme.md` 漂移。

## 1. 技术栈

见 `Readme.md` §3.1。第一阶段：TypeScript + Node.js CLI + Zod + YAML + SQLite + Git worktree；Claude Agent SDK 与 MCP 后置接入；Tauri/React UI 不在当前计划。

## 2. 目录结构

```text
agent/
  src/
    core/                       # 不依赖 cli/ui/sqlite/git/mcp/sdk
      enums.ts
      schemas/                  # task / decision-issue / result / review
      state-machine.ts
      rules/                    # dependency / status-mapping / verification / permission
      index.ts
    application/                # 编排用例，不依赖具体基础设施实现
      ports.ts                  # application→infra 窄接口
      planning-workflow.ts
      context-pack-generator.ts
      scheduler.ts
      state-orchestrator.ts
      merge/                    # rebase-ff / section-writeback / recovery
      index.ts
    infrastructure/             # 外部系统适配，不承载业务规则
      fs/                       # frontmatter-parser / task-doc-repo / global-doc-repo
      sqlite/                   # schema / index-repo
      git/                      # worktree-adapter
      sdk/                      # claude-sdk-adapter / mcp/
      index.ts
    cli/                        # 命令入口，不拥有核心状态机
      framework.ts
      commands/                 # init / plan / task-create / status / rebuild-index / task-run / task-review
      index.ts
  test/                         # 镜像 src 结构
  docs/
  AGENTS.md
  Readme.md
```

## 3. 分层依赖方向（硬约束）

```text
cli → application → core ← infrastructure
infrastructure → core
core 不反向依赖任何层
```

- `core`：领域模型、Schema、状态机、规则，零反向依赖，可被纯单元测试验证。
- `application`：编排用例流程，**不直接依赖 infrastructure 实现类**。
- `infrastructure`：外部系统适配（fs / sqlite / git / sdk / mcp），不承载业务规则。
- `cli`：交互入口与 composition root，负责把 infrastructure 实现注入 application。

## 4. application / infrastructure 依赖倒置约定（ports）

- `application` 经 `src/application/ports.ts` 的窄接口依赖 `infrastructure`：
  - `TaskDocRepositoryPort` — 任务 / 结果 / 审查文档读写（读写即 Zod 校验）。
  - `GlobalDocRepositoryPort` — 全局文档（PROGRESS / DECISIONS / ISSUES）读写与 section 级合并。
  - `WorktreePort` — Git worktree 创建与回收。
  - `GitMergePort` — rebase / 回填 `execution_commits` / fast-forward 合并原语。
- `infrastructure` 提供具体实现类，由 `cli` 在 composition root 处 wiring 注入。
- 借助 TypeScript 结构类型兼容，`infrastructure` 实现类**无需显式 `implements`**。
- `application` **不得直接 import `infrastructure` 实现类**。
- `infrastructure/sdk/executor-contract.ts` 仅被 `cli`（task:run / task:review）依赖、不经 `application`，不构成反向依赖。

## 5. layer 与物理分层的关系

见 `Readme.md` §9 与 `docs/PLAN_coding-agent-workflow.md` §1。本项目把状态机与状态编排归入 `domain`；`state` 取值在本计划中暂不被任何任务使用（枚举仍完整定义并保留，供未来或其他项目启用）。

## 6. 状态索引（SQLite）定位

见 `Readme.md` §3.1（状态索引与文档协议关系）。SQLite 是**派生存储**，非事实来源；写入失败不阻断流程，提供 `rebuild-index` 全量重建；状态机只读 frontmatter，不读 SQLite。

## 7. CLI 边界

CLI 命令签名（`init / plan / task:create / task:run / task:review / status / rebuild-index`）由各 CLI 任务（`docs/tasks/TASK-023…027`）固化入参 / 出参与退出码，并回写本节。

命令名统一为 `caw`（package.json `bin.caw` + `program.name()`，DEC-020）。命令入口为 `runCli(argv)`（`src/cli/framework.ts`），返回退出码（不 `process.exit`，bin 与测试共用）。已固化的命令签名：

- `caw init [targetDir]`（TASK-023）：在 `targetDir`（默认当前工作目录）生成 §6 文档协议骨架（`AGENTS.md` + `docs/{SPEC,ARCHITECTURE,PLAN,PROGRESS,DECISIONS,ISSUES,TESTING}.md` + `docs/tasks/`），模板内嵌、幂等（已存在不覆盖）。入参：目标目录（可选）；出参：stdout 输出新建 / 跳过文件清单；退出码：0 成功（含幂等跳过）、1 业务错误（目标非目录等）、commander 用法错误透传。零领域依赖（不 import core/application/infrastructure）。
- `caw status [--status <TaskStatus>] [--layer <Layer>] [--tasks-dir <dir>]`（TASK-025）：列出任务 id/title/status/layer + 最近执行摘要，按 `--status`/`--layer` 过滤。入参：过滤枚举（可选，经 `pickEnum` 校验非法抛错）、任务目录（默认 `docs/tasks`）；出参：stdout 等宽表格 + 任务计数。**状态以 docs/tasks frontmatter 为权威**（`collectStatus` 纯读 `TaskDocRepository` + `buildExecutionSummary`，**不读 SQLite**，§3.1「读状态不得只依赖 SQLite」）。退出码：0 成功、1 业务错误（目录不存在 / 非法过滤值等）。cli composition root 直接 wiring infra（ARCHITECTURE §4）。
- `caw rebuild-index [--db <path>] [--project-root <dir>]`（TASK-025）：从文档全量重建 SQLite 索引（派生存储，§3.2）。入参：索引库路径（默认 `<项目根>/.caw/index.db`，DEC-021）、项目根（默认 cwd）；出参：stderr 破坏性提示、stdout 四表重建统计。经 `IndexRepository.rebuildFromDocs` 单事务清空四表后从文档（`docs/tasks` + `docs/{DECISIONS,ISSUES}.md`，缺失视为空集）全量重灌；rebuild 后索引 = 文档全集。退出码：0 成功、1 业务错误（任务目录不存在等）。
- `caw task:run <taskId> [--main-ref <ref>] [--worktrees-dir <dir>] [--project-root <dir>]`（TASK-026）：单个任务执行编排集成入口（§11/§3.2）。入参：任务 id（TASK-XXX）、主分支短名（默认 main）、worktree 根（默认 `<项目根>/.worktrees`）、项目根（默认 cwd）；出参：stdout 最终状态 + 后续提示（reviewing→提示 task:review / done→已合并 / 冲突→blocked + 冲突文件）。链路：依赖前置检查（全部 done）→ refreshSourceFiles 刷新回写 context_pack → resolvePathScope 拒绝路径重叠启动 + computeVerificationAllowlist 组装权限边界 → ready→running → WorktreeAdapter.create → R7 restoreNodeModules → Executor 在 worktree 执行产出 .result.md → applyResult 流转。**reviewing 不合并**；**done（no_review 校验通过）才** rebaseAndFastForward（TASK-019）+ writebackGlobalDocs（TASK-020）合并回收 + syncMainWorktreeFile；合并冲突 done→blocked + appendMergeConflictIssue。状态权威在 main 仓库 frontmatter、产物在 worktree；新鲜合并走 019+020（021 recoverMerge 留作崩溃续跑，DEC-022）。默认 DryRunLocalExecutor，全依赖可注入。退出码：0 成功、1 业务错误（任务非 ready / 依赖未完成 / 路径重叠 / 合并冲突等）。
- `caw task:review <taskId> [--main-ref <ref>] [--worktrees-dir <dir>] [--project-root <dir>]`（TASK-027）：Reviewer 审查编排集成入口（§5.3/§15/§3.2）。入参：任务 id（TASK-XXX）、主分支短名（默认 main）、worktree 根（默认 `<项目根>/.worktrees`）、项目根（默认 cwd）；出参：stdout 最终状态 + 后续提示（done→已合并 / rejected/blocked→保留 worktree / 冲突→blocked + 冲突文件）。链路：读任务（状态须 reviewing）→ 定位 worktree → 读 .result.md（worktree）→ no_review 生成 `review_result: skipped` 占位 / 否则调注入 Reviewer 产出 approved|rejected|needs-human → 写 .review.md（main）→ applyReview 映射状态（经 cli 路由适配器：task→main、result→worktree）。**只有 approved→done 才** rebaseAndFastForward（TASK-019）+ writebackGlobalDocs（TASK-020）合并回收 + syncMainWorktreeFile；rejected/blocked 保留 worktree 不合并；合并冲突 done→blocked + appendMergeConflictIssue。审查结论写 .review.md 不污染 .result.md（§5.3）；新鲜合并走 019+020（同 DEC-022/DEC-023）。默认 LocalReviewer（SDK 未就位兜底，确定性产 approved），reviewer/gitMergePort/globalDocRepo/idAllocator 全可注入。退出码：0 成功、1 业务错误（任务非 reviewing / worktree 缺失 / 合并冲突等）。
- `caw plan --from <file> [--reviewed] [--project-root <dir>]`（TASK-024）：SPEC/ARCHITECTURE → PLAN + 任务拆分 CLI 编排入口（§6.4/§8/§11 第 5-6 步）。入参：计划定义文件（YAML/JSON：title+phases+tasks，路径相对 cwd）、`--reviewed` 声明 SPEC/ARCHITECTURE 已通过 Reviewer 独立审查（ISS-018 机器判据，standard 模式必需）、项目根（默认 cwd）；出参：stdout 规划模式 + PLAN 路径 + 任务文件清单，路径冲突走 stderr warning（不阻断）。链路：判 docs/SPEC.md / docs/ARCHITECTURE.md 存在 + `--reviewed` → validatePlanningInputs（standard / bootstrap / failed）→ createPlanDraft + renderPlanMarkdown 落盘 docs/PLAN.md → createTaskDrafts（draft + 预填 context_pack）→ validateTaskGraph（先校验后写盘，环/重复 id 抛错、路径冲突 warning）→ 落盘 docs/tasks/TASK-XXX-<slug>.md（frontmatter + §9 十三节正文模板）。不在 CLI 实现智能拆分（§7/§12，以显式配置文件闭环骨架交付）。退出码：0 成功、1 业务错误（前置不满足 / 任务图含环 / 配置文件不存在或非法等）。
- `caw task:create --id <TASK-XXX> --title <title> --layer <layer> [--slug <slug>] [--depends-on <ids>] [--allowed-paths <paths>] [--forbidden-paths <paths>] [--permissions <perms>] [--no-review] [--restart-on-retry] [--verification <cmds>] [--required-docs <docs>] [--source-files <files>] [--project-root <dir>]`（TASK-024）：增量创建单个任务文件（§11 第 6 步）。入参：任务 id（TASK-XXX，须符 `TASK-\d+`）、标题、层级（type/data/state/domain/ui/page/test）、文件名 slug（省略时从 title 派生，纯中文标题需显式提供）、依赖 / 允许路径 / 禁止路径 / 权限（逗号分隔）、项目根（默认 cwd）；出参：stdout 任务文件路径 + result_file + 初始 status 提示。链路：组装 TaskDraftSpec → createTaskDrafts（TaskFrontmatterSchema 校验 + computeContextPack 预填 context_pack）→ writeTaskFile 落盘（id/layer/slug 前置校验、既有文件拒绝覆盖）。数组类入参用逗号分隔。退出码：0 成功、1 业务错误（非法 id/layer/slug / 任务文件已存在等）。
