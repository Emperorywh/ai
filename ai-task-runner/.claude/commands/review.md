---
description: 执行前审查 SPEC/PLAN/tasks，判定哪些 task 可标记为 ready
---

请以资深前端架构师、代码审查者和 AI Task Runner 调度者视角，审查 docs/SPEC_xxxx.md、docs/PLAN_xxxx.md 和 docs/tasks/*.md。

只做执行前审查，不要实施代码。

重点检查：

1. SPEC 是否有需求遗漏、隐含假设、未关闭的待确认问题。
2. SPEC 是否准确描述当前架构、数据流、状态流和模块边界。
3. PLAN 是否和当前架构一致，是否优先处理必要重构。
4. task 是否可以独立实现、独立验证、独立失败恢复。
5. task 顺序和 depends_on 是否完整，是否存在隐式依赖或循环依赖。
6. agent_allowed_paths 是否过宽或过窄，是否误包含 docs/tasks、SPEC、PLAN、.ai-runner、.git 或 Runner 脚本。
7. verify 命令是否足以判断 task 完成，是否会启动长期服务、执行 git 变更、清理工作区或删除文件。
8. 是否存在跨层耦合、重复逻辑、临时 patch、魔法逻辑或隐式状态风险。
9. 每个 task 是否符合 Runner frontmatter schema。
10. 哪些 task 可以从 draft 改为 ready，哪些必须继续修改。
11. 如果项目存在 .ai-runner/config.yml，检查 task 是否符合项目级 forbidden_agent_paths、verify_policy 和 branch_policy。
12. 每个 task 的实现步骤是否真的能在本 task 的 agent_allowed_paths 内闭环完成，是否会被迫触碰后续 task 的范围或越出当前边界。
13. 声明了 allowed_tools 的 task，其放行范围是否最小且必要，是否可以用更窄的工具规格替代。

输出要求：

- 如果发现问题，只输出具体问题、影响和修改建议。
- 如果没有问题，明确输出“审查通过”，并列出可以标记为 ready 的 task id。
- 不要替我修改文件，不要实施代码。

审查过程中必须运行：

```bash
npm run ai:validate
```

如果 Runner 和业务项目分离，必须在 Runner 目录运行：

```bash
npm run ai:validate -- --project-root <业务项目绝对路径>
```

如果校验失败，必须把失败原因纳入审查问题，不允许输出“审查通过”。
