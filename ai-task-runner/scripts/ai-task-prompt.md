你正在执行一个独立 AI coding task。

任务：{taskId} - {taskTitle}
任务文件：{taskPath}
规格文件：{specPath}
计划文件：{planPath}

必须遵守：

1. 先阅读 AGENTS.md、规格文件、计划文件和当前任务文件。
2. 只实现当前任务，不实现后续任务。
3. 不要主动格式化无关代码。
4. 新增、修改代码必须写多行简体中文注释。
5. 不启动浏览器测试。
6. 不要修改 docs/tasks 下的任何任务文件，也不要修改 task 状态、verify、agent_allowed_paths。
7. 不要提交 git commit，提交由 runner 处理。
8. 不要修改 SPEC、PLAN、.ai-runner、.git 或 Runner 脚本；如果必须修改这些文件才能继续，请停止实现。
9. 如果当前架构不适合实现，请停止实现，并在最后单独输出：AI_TASK_BLOCKED: 原因。
10. 如果需求不明确但可以合理默认，请写出默认假设并继续。
11. 如果必须用户确认才能继续，请停止实现，并在最后单独输出：AI_TASK_BLOCKED: 原因。
12. 你运行在全新的隔离上下文中，并且已被切换到本 task 的独立分支；只阅读与当前任务相关的文件，不要假设任何上一轮对话的内容，也不要去实现后续 task。
13. 不要用 Bash 创建、移动、删除、重定向写入或修改文件；文件变更必须通过受路径闸门保护的 Edit/Write/MultiEdit 工具完成。

AI 允许修改代码路径：

{agentAllowedPaths}

以上路径由 Runner 通过 PreToolUse 钩子在工具调用层事前强制：任何越界编辑（包括对 task 文件、SPEC、PLAN、.git、Runner 脚本的修改）会被直接拒绝，原因会反馈给你。请只使用允许范围内的路径，不要反复尝试越界文件；若实现确实必须触碰这些文件，说明任务边界有问题，应按下面的 blocked 流程停止。

Runner 已预置的数据文件（src -> dest，已就位，无需你创建或重写）：

{runnerAssets}

Runner 已删除的遗留文件（无需你再处理，也不要重新创建）：

{runnerRemove}

验证命令：

{verifyCommands}

完成后请输出：

1. 修改了什么。
2. 为什么这样设计。
3. 是否已自行运行 verify 自测（可选）；最终是否通过以 Runner 执行的 verify 命令为准，你不要为了通过验证而修改 task 状态或 verify。
4. 是否影响后续 task。
