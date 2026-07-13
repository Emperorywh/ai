# CAW MVP

一个只做三件事的命令行工具：深度访谈生成规格、从规格生成需求任务、用独立 Claude Code 会话顺序实现任务。

## 运行要求

- Node.js 20 或更高版本；
- Claude Code CLI 已安装并可以运行；
- Claude Code 已配置可用的模型提供方和访问令牌；
- Anthropic 官方服务或 CC Switch 配置的 Anthropic 兼容服务均可作为提供方，实际兼容性取决于对应服务是否支持结构化输出和 Claude Code 工具调用。

可以先检查本机环境：

```powershell
node --version
claude --version
claude auth status
```

`claude auth status` 只反映 Claude CLI 保存的登录状态，不能单独证明实际请求会发送到哪个模型提供方。使用 CC Switch 时，应以 Claude 用户配置中的 `ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL` 和令牌配置为准。

## 安装与构建

在 CAW 项目根目录执行：

```powershell
npm ci
npm run build
```

如需先验证代码质量，可以执行：

```powershell
npm run typecheck
npm run lint
npm test
```

## 启动方式一：注册 `caw` 命令

在 CAW 项目根目录执行一次：

```powershell
npm link
caw --version
```

之后进入需要开发的目标项目：

```powershell
cd C:\path\to\target-project

caw init .
caw interview "描述你的初始需求"
caw plan
caw status
caw run
```

除了 `init` 可以接收目标目录，其余命令都以当前工作目录作为目标项目根目录。因此，运行 `interview`、`plan`、`status` 和 `run` 前必须先进入目标项目。

如果不再需要全局命令，可以解除注册：

```powershell
npm unlink --global coding-agent-workflow
```

## 启动方式二：不注册全局命令

也可以直接运行构建后的 CLI 入口。先在 CAW 项目根目录记录入口的绝对路径：

```powershell
cd C:\path\to\coding-agent-workflow
$env:CAW_ENTRY = (Resolve-Path .\dist\cli\index.js).Path
```

在同一个 PowerShell 会话中进入目标项目并执行：

```powershell
cd C:\path\to\target-project

node $env:CAW_ENTRY init .
node $env:CAW_ENTRY interview "描述你的初始需求"
node $env:CAW_ENTRY plan
node $env:CAW_ENTRY status
node $env:CAW_ENTRY run
```

## 完整验证示例

建议先在一次性目录或受 Git 管理的测试项目中验证，不要直接对重要项目执行首次测试：

```powershell
mkdir C:\code\ai\caw-demo
cd C:\code\ai\caw-demo

caw init .
caw interview "开发一个简单的命令行待办事项工具"
caw plan
caw status
caw run
```

重复执行 `caw run`，每次只处理第一个未完成任务，直到 `caw status` 显示全部任务完成：

```powershell
caw run
caw status
```

每个任务都会启动全新的 Claude Code 会话，并显式读取：

- `docs/SPEC.md`：总目标与完整规格；
- `docs/PROGRESS.md`：以前完成的能力与重要事实；
- `docs/tasks/TASK-XXX.md`：当前要满足的需求与验收标准。

任务文档不会指定文件路径、技术分层或实现方案。任务完成或阻塞后，系统会更新任务状态和 `docs/PROGRESS.md`。

## 运行安全说明

`caw run` 会让 Claude Code 在当前项目中检查、修改文件并执行命令。当前实现使用跳过权限确认的执行模式，因此首次验证应满足以下条件：

- 确认当前目录就是预期的目标项目；
- 优先使用一次性目录或干净的 Git 工作区；
- 执行前保存重要的未提交修改；
- 不要在包含无关敏感文件的上级目录运行；
- 真实的 `interview`、`plan` 和 `run` 都可能产生模型调用费用。
