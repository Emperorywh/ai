---
id: TASK-035
title: task:review CLI 接线 + CI 真实 API 契约
status: draft
layer: page
depends_on:
  - TASK-027
  - TASK-031
  - TASK-033
allowed_paths:
  - src/cli/commands/task-review.ts
  - test/integration/claude-sdk-real-api.test.ts
  - .github/workflows
forbidden_paths:
  - src/core
  - src/application
  - src/infrastructure
  - src/cli/commands/task-run.ts
  - src/cli/commands/init.ts
  - src/cli/config/provider-profile.ts
permissions: []
no_review: false
restart_on_retry: false
verification:
  - npm run typecheck
  - npm test -- cli/commands/task-review
context_pack:
  required_docs:
    - AGENTS.md
    - docs/ARCHITECTURE.md
    - docs/PROGRESS.md
    - docs/SPEC_claude-sdk-integration.md
  optional_doc_excerpts:
    - docs/SPEC_claude-sdk-integration.md#11-测试策略
    - docs/SPEC_claude-sdk-integration.md#14-验收标准可机器判定
  source_files:
    - src/cli/commands/task-review.ts
    - src/cli/config/provider-profile.ts
    - src/infrastructure/sdk/claude-sdk-reviewer.ts
workflow_outputs:
  result_file: docs/tasks/TASK-035-cli-task-review-wiring.result.md
---

# TASK-035 task:review CLI 接线 + CI 真实 API 契约

## 1. 背景

来自 `PLAN_claude-sdk-integration` P0，SPEC §11/§14-8。`task-review.ts`（TASK-027）`:200 options.reviewer ?? new LocalReviewer()`。本任务接线 SDK 版 reviewer + CI 跑真实 API 契约（anthropic + glm），是本 PLAN 的收尾验证任务。

## 2. 当前目标

- **装配**（`:200`）：profile token 就位 → 构造 `ClaudeSdkReviewer`（注入 031 env/model + 030 sdk-client）→ 注入；`LocalReviewer` 保留兜底（SDK 未配置/key 缺失）。
- **命令选项**：增 `--provider` / `--model` / `--reviewer`；`TaskReviewOutcome` 增 cost 字段。
- **CI 真实 API 契约**（§11/§14-8）：
  - 最小固定任务（如「在指定文件追加一行注释」），**anthropic + glm 各跑一轮**。
  - 断言**契约不断言文本**：`.result.md`/`.review.md` 过 Schema、`execution_status`/`review_result` ∈ 合法枚举、状态流转合法、`system init` 的 `model` 反映档位映射。
  - 无 key 时该子集 **skip 且显式标注**（不静默通过）。

## 3. 所属层级

`page`。

## 4. 必读文件

- AGENTS.md、docs/ARCHITECTURE.md、docs/PROGRESS.md、docs/SPEC_claude-sdk-integration.md（§11/§14）、docs/tasks/TASK-035-cli-task-review-wiring.md
- `src/cli/commands/task-review.ts`、`src/cli/config/provider-profile.ts`、`src/infrastructure/sdk/claude-sdk-reviewer.ts`

## 5. 修改范围

- `src/cli/commands/task-review.ts`、`test/integration/claude-sdk-real-api.test.ts`（新）、`.github/workflows`（CI 配置，若项目已有 CI 则扩展，否则新建）

## 6. 禁止修改范围

- `src/core`、`src/application`、`src/infrastructure`、`task-run.ts`、`init.ts`、`provider-profile.ts`、`claude-sdk-reviewer.ts`

## 7. 不做什么

- 不改 `Reviewer` 接口（SPEC §3）。
- 不断言模型正文措辞（非确定性，§11）。
- 不做 cost 累计告警（P1）、不做 deepseek（P1）。

## 8. 架构约束

- **composition root**：读 profile → 构造 reviewer → 注入 `task-review.ts :200`。
- CI 契约测试用最小任务控成本；受 `ANTHROPIC_API_KEY`/`ZHIPU_API_KEY` secret 控制；无 key skip 且显式标注。
- 不断言文本，受非确定性影响最小（§11）。

## 9. 数据流和状态流要求

CLI 解析 `--reviewer` → 031 profile → 构造 `ClaudeSdkReviewer` → `review` → `ReviewOutcome` → `.review.md`；CI：真实跑 anthropic+glm 最小任务 → 断言契约。

## 10. 预期新增或修改文件

- `src/cli/commands/task-review.ts`、`test/integration/claude-sdk-real-api.test.ts`、`.github/workflows/<ci>`

## 11. 验收标准（SPEC §14-5/7/8）

- `task:review` 走 SDK reviewer：`.review.md` 过 `ReviewFrontmatterSchema`、`review_result` ∈ 合法枚举。
- `--provider glm` + `ZHIPU_API_KEY` 跑通最小任务，过相同 Schema 断言；`system init` 的 `model` 反映 GLM 档位映射。
- CI 无 key 时该子集 skip 且显式标注。
- `typecheck` 0 错误。

## 12. 风险提示

- R-COST：CI 真实 API 成本——最小固定任务 + 无 key skip。
- R-PROVIDER：glm 端点行为差异——契约断言（不断言文本）受非确定性影响最小。
- `.github/workflows` 是否已存在——实现时确认；若无 CI，本任务可只交付集成测试 + 文档化 CI 接入步骤，落 `ISSUES.md`。

## 13. 结束时必须产出（Task Executor 负责）

- docs/tasks/TASK-035-cli-task-review-wiring.result.md
- `DECISIONS.md` 更新建议：task:review 装配 + CI 契约策略
- `ISSUES.md` 更新建议：CI 接入（若项目无 .github/workflows）
