---
id: TASK-043
title: 实现串行 Task Selector 与 Run Policy
status: draft
layer: domain
depends_on:
  - TASK-042
allowed_paths:
  - src/application/orchestration/task-selector.ts
  - src/application/orchestration/run-policy.ts
  - src/application/orchestration/index.ts
  - src/application/index.ts
  - test/application/orchestration/task-selector.test.ts
  - test/application/orchestration/run-policy.test.ts
forbidden_paths:
  - src/core
  - src/infrastructure
  - src/cli
  - src/application/execution
  - src/application/merge
  - docs/SPEC_serial-task-orchestration.md
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- task-selector run-policy
  - npm run lint
context_pack:
  required_docs:
    - docs/SPEC_serial-task-orchestration.md
    - src/application/scheduler.ts
    - src/application/planning-workflow.ts
    - src/application/orchestration/ports.ts
    - src/core/state-machine.ts
    - src/core/schemas/run-schema.ts
  optional_doc_excerpts: []
  source_files:
    - src/application/scheduler.ts
    - src/application/planning-workflow.ts
    - src/application/orchestration/ports.ts
    - src/core/state-machine.ts
    - src/core/schemas/run-schema.ts
workflow_outputs:
  result_file: docs/tasks/TASK-043-app-task-selector-run-policy.result.md
---

# TASK-043 实现串行 Task Selector 与 Run Policy

## 1. 背景

Serial Orchestrator 需要一个纯计算层决定范围快照、确定性顺序、下一个任务、是否允许 draft 自动 ready、是否重试和何时暂停。若这些判断散落在循环中，将形成难以验证的魔法状态。

## 2. 当前目标

- 实现运行范围快照与拓扑序生成。
- 实现显式任务 ID/闭区间范围解析后的选择校验，禁止隐式全仓运行。
- 实现确定性的下一个任务选择。
- 实现 `--approve-plan` 对 draft→ready 的授权判断。
- 实现 Attempt、最大重试、成本上限和状态分类策略。
- 对无可运行任务生成逐任务阻塞诊断。

## 3. 所属层级

`domain`

## 4. 必读文件

- AGENTS.md
- docs/SPEC_serial-task-orchestration.md
- scheduler、state-machine、Run Schema 与 orchestration Ports

## 5. 修改范围

- 纯 Task Selector。
- 纯 Run Policy。
- 详细的状态矩阵测试。

## 6. 禁止修改范围

- 不读写文件、Git、SQLite 或 SDK。
- 不修改 task frontmatter。
- 不创建 worktree 或调用用例。

## 7. 不做什么

- 不实现运行循环。
- 不实现重试执行本身。
- 不处理恢复和幂等回写。

## 8. 架构约束

- 所有函数必须为确定性纯函数。
- 复用 scheduler 拓扑能力，不重复实现依赖算法。
- 任务状态取显式输入，不读取 SQLite。
- 返回判别联合，禁止用 null/布尔组合表达复杂决策。
- 复杂策略必须有简体中文多行注释和完整矩阵测试。

## 9. 数据流和状态流要求

`Tasks + ExplicitScope + RunRecord + PolicyOptions → ScopeSnapshot/NextTask/RetryDecision/PauseDiagnosis`。selector 不执行任何状态转移，只产出上层应采取的动作。

## 10. 预期新增或修改文件

- 新增 `task-selector.ts`、`run-policy.ts`。
- 新增对应测试和 application 导出。

## 11. 验收标准

- done/cancelled 排除，运行中新增任务不进入既有快照。
- 显式范围去重且不存在的 ID 被拒绝；范围外依赖未 done 时被拒绝。
- 无显式范围时不得默认选择所有历史 draft。
- 拓扑层内按任务 id 数值升序。
- 仅依赖全 done 的任务可选。
- 无 approve-plan 时 draft 不可自动推进。
- failed+retry、rejected、needs-human、blocked、成本超限的决策符合 SPEC。
- retry 上限按“首次 + N 次重试”计算无 off-by-one。
- 无可运行任务时返回每个未终结任务的具体原因。

## 12. 风险提示

不要把“当前无可运行任务”一律视为完成；可能是依赖环、取消依赖、blocked 或缺失任务。诊断必须保留差异。

## 13. 结束时必须产出

- `docs/tasks/TASK-043-app-task-selector-run-policy.result.md`
- 记录完整选择与策略矩阵
- 提出必要的全局更新建议
