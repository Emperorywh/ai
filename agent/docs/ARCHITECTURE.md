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
