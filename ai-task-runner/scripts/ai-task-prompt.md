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
8. 如果当前架构不适合实现，请停止实现，并在最后单独输出：AI_TASK_BLOCKED: 原因。
9. 如果需求不明确但可以合理默认，请写出默认假设并继续。
10. 如果必须用户确认才能继续，请停止实现，并在最后单独输出：AI_TASK_BLOCKED: 原因。

AI 允许修改代码路径：

{agentAllowedPaths}

验证命令：

{verifyCommands}

完成后请输出：

1. 修改了什么。
2. 为什么这样设计。
3. 验证命令结果。
4. 是否影响后续 task。
