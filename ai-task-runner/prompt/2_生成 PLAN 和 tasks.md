请阅读 AGENTS.md、当前项目结构、docs/SPEC_xxxx.md。

现在请基于 SPEC 制定开发计划，不要实施代码。

要求：

1. 生成 docs/PLAN_xxxx.md。
2. 将计划拆分为多个可独立实现、可独立验证的 task。
3. 每个 task 尽量控制在 1 到 4 个核心文件内。
4. 如果某个 task 太大，必须继续拆分。
5. 如果发现 SPEC 中有不适合执行的内容，请先指出，不要强行制定计划。
6. 每个 task 必须包含：
   - 目标
   - 涉及模块
   - 不涉及范围
   - 实现步骤
   - 验收标准
   - 验证命令
   - allowed_paths
7. 同时生成 docs/tasks/TASK_xxx.md 文件，供 AI Task Runner 自动执行。
8. 不要实施代码。