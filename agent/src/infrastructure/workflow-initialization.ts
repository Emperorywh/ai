export const SPEC_PLACEHOLDER = `# SPEC — 产品规格说明

> 尚未生成。请使用 prompts/generate-specification.md 与你选择的 AI 工具生成本文档。
`

export const PROGRESS_PLACEHOLDER = `# PROGRESS — 项目进度

> 尚未执行任务。规格与任务文档准备完成后，运行 \`caw run\`。
`

const AGENTS_TEMPLATE = `# 项目执行约束

- 使用简体中文沟通。
- 编码前先理解架构、数据流、状态流和模块边界。
- 新增或修改的复杂代码必须写多行简体中文注释。
- 遵循高内聚、低耦合、单一职责和分层设计。
- 不添加临时 patch、fallback、deprecated 或 legacy 兼容逻辑。
- 不主动格式化无关代码，不自动启动浏览器测试。
`

const SPECIFICATION_PROMPT = `# 提示词：通过需求访谈生成产品规格

你是一名资深产品分析师。请通过深度访谈，把我提供的初始需求整理为完整、无实现绑定、可以验收的产品规格。

## 工作方式

1. 先理解初始需求；如果我明确提供了本地文件、目录或其他资料，优先读取并核对，不要求我重复粘贴可访问内容。
2. 信息不足时，每轮只提出一个信息增益最高的问题，问题必须具体且容易回答。
3. 主动覆盖目标、用户、范围、非目标、核心流程、业务规则、数据、状态、异常、边界和验收标准。
4. 不重复已经回答的问题；可以可靠推导的内容直接推导，并在规格中明确标注假设。
5. 访谈阶段只分析产品需求，不设计技术架构，不指定框架、文件、目录、类或函数。
6. 信息足够后停止追问，一次性生成最终规格。

## 最终交付契约

- 最终交付物是 docs/SPEC.md 的完整 Markdown 内容。
- 如果你具备项目文件写入能力，直接覆盖写入 docs/SPEC.md；否则只输出可原样保存到该路径的完整正文。
- 规格至少包含：目标、用户与场景、范围、非目标、核心流程、功能需求、业务规则、数据与状态、异常与边界、验收标准。
- 规格描述“系统必须提供什么”，不包含任务拆分和实现方案。
- 不修改源代码，不生成任务文件，不修改 docs/PROGRESS.md。

## 初始需求

[在这里补充你的初始需求，然后把整份提示词交给 AI 工具]
`

const TASKS_PROMPT = `# 提示词：把产品规格拆成顺序任务

你是一名需求规划师。请读取 docs/SPEC.md，或者使用我随提示词提供的完整规格，把规格拆成可由独立编码 Agent 顺序执行的最小任务集合。

## 拆分原则

1. 任务严格按执行顺序排列；后续任务可以假设前面的任务已经完成。
2. 每个任务职责单一、边界明确，并能由一个独立 Claude Code 会话完成。
3. 任务只描述用户可观察需求与验收标准，不指定文件、目录、框架、类名、函数名或实现方案。
4. 不创建 Reviewer、文档治理、发布、灰度、兼容、迁移或平台化任务，除非规格明确要求。
5. 不把同一需求重复拆到多个任务，不提前创建未来扩展点。
6. 验收标准必须可观察、可验证，但不冻结具体测试工具。

## 任务文件契约

- 从 TASK-001 开始连续编号，并按编号写入 docs/tasks/TASK-XXX.md。
- 每个任务初始状态必须是 pending。
- 每个文件必须严格使用以下结构：

~~~markdown
---
id: TASK-001
title: 任务标题
status: pending
---

# TASK-001 — 任务标题

## 需求

清楚描述本任务必须提供的用户可观察能力。

## 验收标准

- 第一条可验证标准
- 第二条可验证标准
~~~

## 最终交付契约

- 如果你具备项目文件写入能力，先删除 docs/tasks 中已有的 TASK-数字.md，再写入完整的新任务集合。
- 生成新任务集合时，把 docs/PROGRESS.md 重置为“尚未执行任务”的初始状态，避免旧计划的执行事实污染新计划。
- 如果你不具备文件写入能力，按文件路径分组输出每个任务文件的完整 Markdown 正文。
- 不修改 docs/SPEC.md、AGENTS.md 和项目源代码。
- 完成前检查编号连续、Frontmatter 合法、至少存在一个任务且每个任务至少包含一条验收标准。
`

export interface InitialWorkflowFile {
  readonly relativePath: string
  readonly content: string
}

/**
 * 初始化文件清单集中定义工作流协议和两份跨 AI 工具提示词。
 * 文件仓储只负责可靠写入，不再同时承担提示词内容设计职责。
 */
export const INITIAL_WORKFLOW_FILES: readonly InitialWorkflowFile[] = [
  { relativePath: 'AGENTS.md', content: AGENTS_TEMPLATE },
  { relativePath: 'docs/SPEC.md', content: SPEC_PLACEHOLDER },
  { relativePath: 'docs/PROGRESS.md', content: PROGRESS_PLACEHOLDER },
  { relativePath: 'prompts/generate-specification.md', content: SPECIFICATION_PROMPT },
  { relativePath: 'prompts/generate-tasks.md', content: TASKS_PROMPT },
]
