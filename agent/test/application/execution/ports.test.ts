import { describe, expect, it } from 'vitest'
// TASK-036：application execution/ports 契约模块的自测。
//   - buildStartupPrompt / ExecutorError 是本模块的运行时导出（§18 启动提示 + 执行错误基类）。
//   - 编译期证明 SDK 实现满足 Ports（任务 §11 验收）——经 assertExecutorPort / assertReviewerPort
//     把 infra 实现类实例赋给 Port 类型，tsc --noEmit 在实现与 Port 漂移时失败。
import {
  buildStartupPrompt,
  ExecutorError,
  type TaskExecutorPort,
  type TaskReviewerPort,
} from '../../../src/application/execution/ports.js'
import {
  ClaudeSdkExecutor,
  ClaudeSdkReviewer,
  DryRunLocalExecutor,
} from '../../../src/infrastructure/index.js'

/* ============================================================ *
 * 编译期证明：infra 实现 satisfies Ports（任务 §11）
 * ============================================================ */

/**
 * 接受 TaskExecutorPort 的占位函数——传入 infra 实现类实例，编译期校验结构兼容（运行时无副作用）。
 * 若 DryRunLocalExecutor / ClaudeSdkExecutor 与 TaskExecutorPort 漂移，tsc 在此失败。
 */
function assertExecutorPort(_p: TaskExecutorPort): void {}

/**
 * 接受 TaskReviewerPort 的占位函数——传入 infra ClaudeSdkReviewer 实例，编译期校验结构兼容。
 * 若 ClaudeSdkReviewer 与 TaskReviewerPort 漂移，tsc 在此失败。
 */
function assertReviewerPort(_p: TaskReviewerPort): void {}

describe('Ports 契约 —— infra 实现 satisfies Ports（编译期证明，任务 §11）', () => {
  it('DryRunLocalExecutor / ClaudeSdkExecutor 赋给 TaskExecutorPort 编译通过', () => {
    // 以下两行赋值是编译期校验：实现类经 implements TaskExecutorPort 满足执行 Port。
    assertExecutorPort(new DryRunLocalExecutor())
    assertExecutorPort(new ClaudeSdkExecutor(null))
    expect(true).toBe(true) // 占位断言（编译期校验才是本测试要点）
  })

  it('ClaudeSdkReviewer 赋给 TaskReviewerPort 编译通过', () => {
    // ClaudeSdkReviewer 经 implements TaskReviewerPort 满足审查 Port。
    assertReviewerPort(new ClaudeSdkReviewer({ providerEnv: {} }))
    expect(true).toBe(true)
  })
})

/* ============================================================ *
 * buildStartupPrompt（§18 模板占位替换，本模块为单一来源）
 * ============================================================ */

describe('buildStartupPrompt', () => {
  it('替换 §18 模板中的任务文件与结果文件占位（不残留 TASK-XXX-xxx）', () => {
    const prompt = buildStartupPrompt({
      taskId: 'TASK-036',
      taskFile: 'docs/tasks/TASK-036-app-execution-review-ports.md',
      resultFile: 'docs/tasks/TASK-036-app-execution-review-ports.result.md',
    })

    expect(prompt).not.toContain('TASK-XXX-xxx')
    // 任务文件占位出现于「必读核心第 4 项」与「执行规则：本次上下文只执行」两处。
    expect(prompt).toContain('4. docs/tasks/TASK-036-app-execution-review-ports.md')
    expect(prompt).toContain('本次上下文只执行 docs/tasks/TASK-036-app-execution-review-ports.md')
    // 结果文件占位出现于「完成 / 阻塞 / 失败后必须生成」。
    expect(prompt).toContain('必须生成 docs/tasks/TASK-036-app-execution-review-ports.result.md')
  })

  it('保留 §18 模板核心执行规则文本（AGENTS.md 为唯一权威）', () => {
    const prompt = buildStartupPrompt({
      taskId: 'TASK-001',
      taskFile: 'docs/tasks/TASK-001-foo.md',
      resultFile: 'docs/tasks/TASK-001-foo.result.md',
    })
    expect(prompt).toContain('不执行后续任务')
    expect(prompt).toContain('不依赖历史聊天记录')
    expect(prompt).toContain('AGENTS.md 是编码约束唯一权威')
  })
})

/* ============================================================ *
 * ExecutorError（执行错误基类）
 * ============================================================ */

describe('ExecutorError', () => {
  it('是 Error 子类且 name 为 ExecutorError', () => {
    const err = new ExecutorError('执行失败')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ExecutorError')
    expect(err.message).toBe('执行失败')
  })
})
