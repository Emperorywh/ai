# AI Task Runner MVP

这是一个本地 AI coding 任务执行器模板。

它的职责划分是：

- Runner 负责选任务、切分支、调用 Claude、验证、检查改动范围、更新任务状态、提交代码。
- Claude 只负责实现当前 task。
- 任务上下文来自文件，不依赖上一轮聊天上下文。

## 使用方式

在真实项目根目录放入这些文件后，安装依赖不是必须的，直接使用 Node.js 即可。

```bash
npm run ai:status
npm run ai:next
npm run ai:all
```

## 任务文件格式

每个任务放在 `docs/tasks/*.md`，并在 frontmatter 中声明状态、分支、允许修改路径和验证命令。

```markdown
---
id: TASK_001
status: pending
branch: ai/task-001-filter-model
spec: docs/SPEC_xxxx.md
plan: docs/PLAN_xxxx.md
commit: "feat(TASK_001): 抽离筛选状态模型"
allowed_paths:
  - src/features/orders/model/
  - src/features/orders/__tests__/
verify:
  - pnpm typecheck
  - pnpm test filterState
---
```

## 状态流

```text
pending -> running -> done
              |
              v
       failed / blocked
```

## 安全闸门

- 工作区不干净会停止。
- 没有 `verify` 命令会停止。
- Claude 没有产生 task 文件之外的改动会停止。
- 改动超出 `allowed_paths` 会停止。
- 验证命令失败会停止。
- Runner 只提交成功完成的 task。

## Claude 命令

默认执行：

```bash
claude -p "<task prompt>"
```

如果你的 Claude Code 命令名不同，可以设置：

```bash
AI_RUNNER_CLAUDE_BIN=claude
```

如果需要增加 `--max-turns`、`--output-format`、`--allowedTools` 等参数，建议修改 `scripts/task-lib.mjs` 里的 `createClaudeCommand`。
