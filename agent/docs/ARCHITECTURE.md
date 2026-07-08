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
