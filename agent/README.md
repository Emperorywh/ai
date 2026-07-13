# CAW MVP

一个只做三件事的命令行工具：深度访谈生成规格、从规格生成需求任务、用独立 Claude Code 会话顺序实现任务。

## 运行

需要 Node.js 20+，并确保 Claude Code 可用的 Anthropic 鉴权已经配置，例如 `ANTHROPIC_API_KEY`。

```powershell
npm install
npm run build
npm link
```

在需要开发的目标项目中执行：

```powershell
caw init .
caw interview "描述你的初始需求"
caw plan
caw status
caw run
```

重复执行 `caw run`，每次只处理第一个未完成任务。每个任务都会启动全新的 Claude Code 会话，并显式读取：

- `docs/SPEC.md`：总目标与完整规格；
- `docs/PROGRESS.md`：以前完成的能力与重要事实；
- `docs/tasks/TASK-XXX.md`：当前要满足的需求与验收标准。

任务文档不会指定文件路径、技术分层或实现方案。任务完成或阻塞后，系统会更新任务状态和 `docs/PROGRESS.md`。
