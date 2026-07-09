import { Command } from 'commander'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * `init` 命令：在目标目录初始化文档协议骨架。
 *
 * 职责（见 docs/tasks/TASK-023 §2 / Readme §6 文档体系）：
 *  - 生成根目录 `AGENTS.md` 与 `docs/` 下的 SPEC / ARCHITECTURE / PLAN / PROGRESS /
 *    DECISIONS / ISSUES / TESTING 八份文档骨架，以及 `docs/tasks/` 目录。
 *  - 模板内嵌，已存在的文件**一律不覆盖**（幂等）。
 *  - 只写模板文件，**不依赖** core / application / infrastructure 任何领域逻辑
 *    （TASK-023 §6 / §12：init 生成的是「目标项目」骨架，不是本项目自身的约束副本）。
 */

/** 单个待生成文件：相对项目根的路径 + 模板内容。 */
export interface ScaffoldFile {
  readonly path: string
  readonly content: string
}

/** scaffoldProject 执行结果。 */
export interface ScaffoldResult {
  /** 实际写入的项目根绝对路径（已规范化）。 */
  readonly projectRoot: string
  /** 本次新建的文件（相对 projectRoot 的路径）。 */
  readonly created: string[]
  /** 因已存在而跳过、未覆盖的文件（相对 projectRoot 的路径）。 */
  readonly skipped: string[]
}

const AGENTS_TEMPLATE = `# AGENTS — 通用执行约束

> 本文件是 agent 通用执行约束的唯一权威来源。任务或工作流特有的增量约束（如修改范围、状态机规则）单独写在对应任务文件中。

## 1. 沟通与语言

- 使用简体中文回复与撰写文档。
- 复杂或非显而易见的逻辑必须添加简体中文多行注释；自解释的简单代码不强求注释，避免噪声。
- 生成 commit message 必须使用简体中文。

## 2. 架构与边界

- 先理解架构，再编码：先明确数据流、状态流与模块边界，再动手实现。
- 不跨层调用：遵守项目分层依赖方向，下层不得反向依赖上层。
- 发现架构不合理时优先重构，而不是继续堆逻辑。

## 3. 代码质量

- 不引入临时 patch 解决结构性问题；网络重试、错误提示、环境能力检测等运行时容错必须作为显式错误处理或能力声明写入文档。
- 不写巨型函数或巨型组件：职责单一，必要时拆分。
- 不制造隐式状态：状态归属与流转必须显式、可追踪。
- 不复制粘贴重复逻辑：优先抽取复用。

## 4. 工作纪律

- 不主动格式化无关代码，只改当前任务范围内必须改的部分。
- 不自动启动浏览器测试，除非用户明确要求。
- 每个任务只负责一个清晰目标，只完成当前任务，不提前实现后续任务。
- 每次修改后检查是否增加耦合、引入技术债或破坏架构一致性。
`

const SPEC_TEMPLATE = `# SPEC — 产品与功能规格

> 回答“要做什么”。本文件是产品与功能规格的事实来源，由 Orchestrator 在规格阶段填充后提交 Reviewer 审查。

## 1. 项目背景

（待填充）

## 2. 产品目标

（待填充）

## 3. 非目标

（待填充）

## 4. 用户角色

（待填充）

## 5. 核心场景

（待填充）

## 6. 用户流程

（待填充）

## 7. 页面需求

（待填充）

## 8. 组件需求

（待填充）

## 9. 交互需求

（待填充）

## 10. 数据需求

（待填充）

## 11. 状态需求

（待填充）

## 12. 错误处理

（待填充）

## 13. 空状态

（待填充）

## 14. 加载状态

（待填充）

## 15. 边界情况

（待填充）

## 16. 可访问性要求

（待填充）

## 17. 验收标准

（待填充）
`

const ARCHITECTURE_TEMPLATE = `# ARCHITECTURE — 架构约束

> 回答“应该如何组织系统”。本文件是架构事实来源，权威产品规格见 docs/SPEC.md，由 Orchestrator 在架构阶段填充后提交 Reviewer 审查。

## 1. 技术栈

（待填充）

## 2. 目录结构

（待填充）

## 3. 分层设计

（待填充）

## 4. 模块边界

（待填充）

## 5. 数据模型

（待填充）

## 6. 状态管理策略

（待填充）

## 7. API / service 边界

（待填充）

## 8. UI 组件分层

（待填充）

## 9. 业务逻辑归属

（待填充）

## 10. 复用策略

（待填充）

## 11. 命名约定

（待填充）

## 12. 禁止跨层调用规则

（待填充）

## 13. 可测试性策略

（待填充）

## 14. 未来扩展点

（待填充）
`

const PLAN_TEMPLATE = `# PLAN — 阶段级开发计划

> 回答“按什么顺序做”。本文件描述阶段、依赖关系和交付顺序，不应写成过细的任务清单；具体任务拆分在 docs/tasks/ 中维护。

## P1 项目结构与基础约束

（待填充：目录骨架、工具链、基础约束文档）

## P2 类型系统与领域模型

（待填充）

## P3 数据访问层

（待填充）

## P4 状态管理层

（待填充）

## P5 核心业务逻辑

（待填充）

## P6 基础 UI 组件

（待填充）

## P7 页面组合

（待填充）

## P8 边界状态

（待填充）

## P9 测试与验收

（待填充）
`

const PROGRESS_TEMPLATE = `---
doc: PROGRESS
status: active
---

# PROGRESS — 当前项目状态

> 本文件只保留当前有效状态，用于上下文恢复。完整历史记录在各 TASK-XXX.result.md 与 docs/DECISIONS.md。

## 当前完成到哪个任务

（尚未开始任何任务）

## 当前系统可用能力

（待填充）

## 当前架构状态

（待填充）

## 后续任务必须知道的信息

（待填充）

## 当前未解决问题摘要

（暂无未解决问题）

## 建议下一个任务

（待填充）
`

const DECISIONS_TEMPLATE = `# DECISIONS — 架构决策记录

> 记录重要架构决策。每条决策必须保留稳定机器字段（id / title / status / scope / created_from_task / decision / rationale / consequences），使用 fenced YAML block 表达；Markdown 正文可补充解释。

<!-- 条目格式示例（填写后删除本注释）：

## DEC-001 决策标题

    id: DEC-001
    title: 决策标题
    status: proposed
    scope: 影响范围
    created_from_task: SPEC
    decision: 最终选择
    rationale: 决策背景与理由
    consequences: 后续约束

正文可补充解释。
-->

## 决策列表

（暂无决策记录）
`

const ISSUES_TEMPLATE = `# ISSUES — 未解决问题与阻塞项

> 记录未解决问题、阻塞项和需要人工确认的事项。每个问题必须保留稳定机器字段（id / title / status / severity / scope / created_from_task / owner / recommended_action），使用 fenced YAML block 表达；Markdown 正文可补充上下文。

<!-- 条目格式示例（填写后删除本注释）：

## ISS-001 问题标题

    id: ISS-001
    title: 问题标题
    status: open
    severity: medium
    scope: 影响范围
    created_from_task: SPEC
    owner: 需要谁确认
    recommended_action: 建议处理方式

正文可补充上下文。
-->

## 问题列表

（暂无未解决问题）
`

const TESTING_TEMPLATE = `# TESTING — 验证策略

> 定义验证策略。自动验证命令可声明 layers（适用的 layer 枚举值列表）与 requires_permissions（除 run_commands 外需要的额外能力）；声明使用 YAML frontmatter 或 fenced YAML block 表达，系统不依赖命令字符串启发式授权。

## 自动验证命令

- 类型检查：npm run typecheck
- 单元测试：npm test
- 构建检查：npm run build

## 人工验收步骤

（待填充）

## 不自动执行的测试类型

- 浏览器测试（不自动启动，除非用户明确要求）

## 已知无法自动验证的项目

（待填充）
`

const GITKEEP_TEMPLATE = `# 该目录用于存放任务文档：TASK-XXX-*.md（任务规格）/ .result.md（执行结果）/ .review.md（审查结论）。本占位文件可保留或删除。
`

/**
 * init 生成的全部文件清单（相对项目根），单一来源。
 * docs/ 与 docs/tasks/ 目录随首个文件写入由 mkdirSync recursive 一并建立。
 */
export const DOC_FILES: readonly ScaffoldFile[] = [
  { path: 'AGENTS.md', content: AGENTS_TEMPLATE },
  { path: 'docs/SPEC.md', content: SPEC_TEMPLATE },
  { path: 'docs/ARCHITECTURE.md', content: ARCHITECTURE_TEMPLATE },
  { path: 'docs/PLAN.md', content: PLAN_TEMPLATE },
  { path: 'docs/PROGRESS.md', content: PROGRESS_TEMPLATE },
  { path: 'docs/DECISIONS.md', content: DECISIONS_TEMPLATE },
  { path: 'docs/ISSUES.md', content: ISSUES_TEMPLATE },
  { path: 'docs/TESTING.md', content: TESTING_TEMPLATE },
  { path: 'docs/tasks/.gitkeep', content: GITKEEP_TEMPLATE },
]

/** 确保项目根存在且为目录；已存在但非目录则抛错（非法目标，不静默）。 */
function ensureProjectRoot(projectRoot: string): void {
  if (existsSync(projectRoot) && !statSync(projectRoot).isDirectory()) {
    throw new Error(`目标路径已存在且不是目录：${projectRoot}`)
  }
  mkdirSync(projectRoot, { recursive: true })
}

/**
 * 在 targetDir 生成文档协议骨架（幂等：已存在文件不覆盖）。
 *
 * 纯文件 I/O，不调用任何领域逻辑；每个文件写入前用 mkdirSync(recursive) 确保父目录
 * 存在，故 docs/ 与 docs/tasks/ 目录作为副作用被建立，满足 §11「docs/tasks/ 存在」。
 */
export function scaffoldProject(targetDir: string): ScaffoldResult {
  const projectRoot = resolve(targetDir)
  ensureProjectRoot(projectRoot)

  const created: string[] = []
  const skipped: string[] = []
  for (const file of DOC_FILES) {
    const absPath = join(projectRoot, file.path)
    mkdirSync(dirname(absPath), { recursive: true })
    if (existsSync(absPath)) {
      skipped.push(file.path)
      continue
    }
    writeFileSync(absPath, file.content, 'utf8')
    created.push(file.path)
  }
  return { projectRoot, created, skipped }
}

/**
 * 向 commander program 注册 init 命令。
 * 退出码与错误输出归 framework.runCli 统一处理；本函数只负责命令签名与执行。
 */
export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('在目标目录初始化文档协议骨架（AGENTS.md + docs/ 文档体系 + docs/tasks/）')
    .argument('[targetDir]', '目标目录，默认当前工作目录')
    .action((targetDir: string | undefined) => {
      const dir = targetDir ?? process.cwd()
      const result = scaffoldProject(dir)
      console.log(`已在 ${result.projectRoot} 初始化文档协议骨架`)
      if (result.created.length > 0) {
        console.log(`  新建 ${result.created.length} 个文件：`)
        for (const p of result.created) console.log(`    + ${p}`)
      }
      if (result.skipped.length > 0) {
        console.log(`  跳过 ${result.skipped.length} 个已存在文件（未覆盖）：`)
        for (const p of result.skipped) console.log(`    ~ ${p}`)
      }
    })
}
