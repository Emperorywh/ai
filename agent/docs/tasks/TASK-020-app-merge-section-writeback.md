---
id: TASK-020
title: App 合并：全局文档 section 回写与冲突
status: draft
layer: domain
depends_on:
  - TASK-012
  - TASK-015
  - TASK-016
allowed_paths:
  - src/application/merge/section-writeback.ts
  - src/application/index.ts
  - test/application/merge/section-writeback.test.ts
forbidden_paths:
  - src/core
  - src/infrastructure
  - src/cli
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- application/merge/section-writeback
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
  optional_doc_excerpts:
    - Readme.md#32-并行执行与-worktree-合并策略
    - Readme.md#10-任务执行结果模板
  source_files:
    - src/application/scheduler.ts
    - src/application/ports.ts
workflow_outputs:
  result_file: docs/tasks/TASK-020-app-merge-section-writeback.result.md
---

# TASK-020 App 合并：全局文档 section 回写与冲突

## 1. 背景

来自 PLAN P6。合并回收后，Orchestrator 按拓扑序**串行**回写全局文档（§3.2）：每次基于最新主分支重读 → 合并 `global_update_requests`；progress 按 section 级合并（replace 后写者覆盖先写者，落选者入 ISSUES）；decisions/issues 由 Orchestrator 统一分配 id 后去重追加。

## 2. 当前目标

实现 `writebackGlobalDocs(globalRepo, orderedRequests, { idAllocator })`：
- progress：按拓扑序逐条 apply（复用 TASK-012 的 section 合并）；多条 replace 命中同 section → 后写者覆盖，先写者落选项产出冲突清单。
- decisions/issues：分配 id（`DEC-XXX`/`ISS-XXX`）后去重追加。
- 返回：更新后的文档 + 冲突清单（供置 blocked / 落 ISSUES）。

## 3. 所属层级

`domain`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/tasks/TASK-020-app-merge-section-writeback.md
- Readme.md §3.2/§10

## 5. 修改范围

- `src/application/merge/section-writeback.ts`、`src/application/index.ts`、`test/application/merge/section-writeback.test.ts`

## 6. 禁止修改范围

- `src/core`、`src/infrastructure`、`src/cli`、`rebase-ff.ts`

## 7. 不做什么

- 不做 rebase/ff（TASK-019）。
- 不做幂等恢复（TASK-021）。
- 不直接把任务置 blocked（产出冲突清单，由编排/CLI 决策）。

## 8. 架构约束

- 对全局文档仓储的依赖经 `application/ports.ts` 的 `GlobalDocRepositoryPort`（TASK-015 建立），不直接 import infra 实现类；复用调度（拓扑序）。
- 回写串行、每次重读最新主分支文档（§3.2）。
- id 分配由注入的 `idAllocator` 完成（单一分配点，避免重复 id）。
- decisions/issues 不参与 section 合并，仅按 id 去重追加。

## 9. 数据流和状态流要求

按拓扑序的 `global_update_requests` → 串行合并 → 更新 PROGRESS/DECISIONS/ISSUES + 冲突清单。

## 10. 预期新增或修改文件

- `src/application/merge/section-writeback.ts`、`test/application/merge/section-writeback.test.ts`、`src/application/index.ts`

## 11. 验收标准

- append 按 topology 拼接；不同 section 互不干扰。
- 同 section 多 replace → 后写者覆盖、先写者入冲突清单。
- decisions/issues id 分配唯一且去重；`typecheck` 0 错误。

## 12. 风险提示

- 重读最新文档与并发安全：本任务假定串行回写（§3.2 明确串行），不要引入并发合并。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-020-app-merge-section-writeback.result.md
- `PROGRESS.md` 更新建议：section 回写就绪
