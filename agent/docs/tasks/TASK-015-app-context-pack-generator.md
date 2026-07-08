---
id: TASK-015
title: App Context Pack 生成器
status: draft
layer: domain
depends_on:
  - TASK-003
  - TASK-011
allowed_paths:
  - src/application/context-pack-generator.ts
  - src/application/ports.ts
  - src/application/index.ts
  - test/application/context-pack-generator.test.ts
forbidden_paths:
  - src/core
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- application/context-pack-generator
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#8-context-pack-上下文包
  source_files:
    - src/core/schemas/task-schema.ts
    - src/infrastructure/fs/task-doc-repo.ts
workflow_outputs:
  result_file: docs/tasks/TASK-015-app-context-pack-generator.result.md
---

# TASK-015 App Context Pack 生成器

## 1. 背景

来自 PLAN P4。每个 Task Executor 启动前由 Orchestrator 生成 Context Pack（§8），裁剪规则：必读核心 ∪ `required_docs` ∪ `optional_doc_excerpts` ∪ `source_files`；`source_files` 在依赖完成后用其 `.result.md` 的 `modified_files/created_files` 刷新。

## 2. 当前目标

实现：
- `computeContextPack(task, { dependencyResults })`：应用并集规则，产出最终注入清单。
- `refreshSourceFiles(task, dependencyResults)`：用已完成依赖的 `.result.md` 文件清单替换预填 `source_files`，返回需回写 frontmatter 的新值。
- 建立 `src/application/ports.ts`：定义 application→infrastructure 的窄接口 `TaskDocRepositoryPort`、`GlobalDocRepositoryPort`、`WorktreePort`、`GitMergePort`（方法集覆盖 TASK-017/019/020/021/029 所需的任务/结果/审查读写、worktree 生命周期与 git merge 原语，供后续 application 任务复用，infra 层不显式 `implements`、由 CLI 层 wiring 注入）。

## 3. 所属层级

`domain`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-015-app-context-pack-generator.md
- Readme.md §8

## 5. 修改范围

- `src/application/context-pack-generator.ts`、`src/application/ports.ts`、`src/application/index.ts`、`test/application/context-pack-generator.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/infrastructure`、`src/cli`

## 7. 不做什么

- 不执行 frontmatter 回写（由状态编排 TASK-017 在 ready→running 时调用仓储写回）。
- 不注入文档内容（注入是 SDK 适配器 TASK-022 的职责）。
- 不实现 infra 具体类（`ports.ts` 只定义窄接口，实现归 TASK-011/012/018）。

## 8. 架构约束

- 依赖 core Task Schema（类型）；对 infra 的依赖一律经本任务建立的 `application/ports.ts` 接口，不直接 import infra 实现类（`task-doc-repo.ts` 仅作定义接口形状的参考）。
- 必读核心（AGENTS/ARCHITECTURE/PROGRESS/任务文件）硬性下限，不得被 frontmatter 省略。
- 不得扩展范围：最终清单 ⊆ 候选来源。

## 9. 数据流和状态流要求

输入：任务 frontmatter + 依赖 result 摘要；输出：Context Pack 清单 + 待回写的 `source_files`。

## 10. 预期新增或修改文件

- `src/application/context-pack-generator.ts`、`src/application/ports.ts`、`test/application/context-pack-generator.test.ts`、`src/application/index.ts`

## 11. 验收标准

- 并集规则用例：必读核心恒在；`source_files` 刷新后 = 依赖实际产物。
- 依赖未完成时不刷新（保留预填）；`typecheck` 0 错误。

## 12. 风险提示

- 任务文件本身不计入 `required_docs` 数组但属必读核心（§8），实现时需显式并入，避免遗漏。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-015-app-context-pack-generator.result.md
- `PROGRESS.md` 更新建议：Context Pack 生成器就绪
