/**
 * Infrastructure 子进程验证 Runner(串行编排 SPEC FR-011 / §20.3,任务 TASK-040)。
 *
 * VerificationRunnerPort 的真实实现:在 worktree 内经子进程执行单条验证命令,采集真实
 * 退出码、耗时与受控 stdout/stderr 摘要。application 层(VerifyTaskUseCase)只经 Port
 * 依赖此能力,不感知 shell / child_process 细节(依赖倒置:本类 implements application
 * 的 Port 抽象)。
 *
 * 跨平台与进程语义(任务 §12 风险点 / §8「命令执行细节封装在 infrastructure」):
 *   - shell 执行:经 Node `spawn(command, { shell: true })`,Windows 走 cmd.exe、POSIX
 *     走 /bin/sh,由 Node 统一跨平台(不自行拼 shell 路径)。
 *   - cwd = worktreePath(任务 worktree 根,FR-011「在 worktree 内独立执行」)。
 *   - 环境继承 process.env(验证命令依赖 PATH / 项目级 env;不注入额外放权)。
 *   - 超时:超 timeoutMs 先 SIGTERM 优雅终止,宽限后 SIGKILL 强制,避免僵尸进程
 *     (任务 §12);超时映射为 result='failed' + exitCode=null + outputSummary 注明超时
 *     (VerificationRunnerPort 契约,FR-011.4)。
 *   - 输出上限:stdout / stderr 各最多累计 maxOutputBytes(超出截断并标记),合并摘要
 *     再截断到 SUMMARY_MAX,避免超大日志进入内存与 result(任务 §8「输出必须设上限」)。
 *   - spawn 失败(ENOENT / cwd 不存在):'error' 事件 → result='failed' + exitCode=null
 *     + outputSummary 注明启动失败(不静默、不伪造 passed,任务 §11「spawn 失败显式返回」)。
 *
 * 权威来源:串行编排 SPEC FR-011(系统执行验证)/ §20.3(Ports)/ 任务 §12(风险点)。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import type {
  VerificationRunnerInput,
  VerificationRunnerPort,
  VerificationRunnerResult,
} from '../../application/execution/ports.js'
import type { VerificationResult } from '../../core/index.js'

/* ============================================================ *
 * 配置默认值
 * ============================================================ */

/** 默认超时 5 分钟(NFR-005 避免无必要长跑;测试可注入短超时覆盖)。 */
const DEFAULT_TIMEOUT_MS = 300_000

/**
 * 默认 stdout / stderr 各最大累计字节(任务 §8「输出必须设上限」)。
 * 16KB 单流足以容纳典型测试摘要,避免 npm test 全量日志进入内存。
 */
const DEFAULT_MAX_OUTPUT_BYTES = 16_384

/** 合并后 outputSummary 的最大字符数(摘要,非完整日志)。 */
const SUMMARY_MAX_CHARS = 4_096

/* ============================================================ *
 * ProcessVerificationRunnerOptions
 * ============================================================ */

/** ProcessVerificationRunner 构造选项(均可选,测试注入短超时 / 小上限覆盖默认)。 */
export interface ProcessVerificationRunnerOptions {
  /** 单条命令超时毫秒(超时映射 failed + 强制终止);默认 5 分钟。 */
  readonly timeoutMs?: number
  /** stdout / stderr 各最大累计字节(超出截断);默认 16KB。 */
  readonly maxOutputBytes?: number
}

/* ============================================================ *
 * ProcessVerificationRunner
 * ============================================================ */

/**
 * 子进程验证 Runner(VerificationRunnerPort 真实实现)。
 *
 * 构造时可注入 timeoutMs / maxOutputBytes(测试确定性);默认值面向生产。每次 run 经
 * spawn 异步执行命令,Promise 在子进程 close / error 时 resolve,绝不泄漏未清理的定时器
 * 或僵尸子进程(settled 守卫 + clearTimeout + 强制 kill)。
 */
export class ProcessVerificationRunner implements VerificationRunnerPort {
  readonly name = 'process-runner'
  private readonly timeoutMs: number
  private readonly maxOutputBytes: number

  constructor(opts: ProcessVerificationRunnerOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  }

  async run(input: VerificationRunnerInput): Promise<VerificationRunnerResult> {
    const { command, worktreePath } = input
    const start = performance.now()

    return new Promise<VerificationRunnerResult>((resolve) => {
      let stdout = ''
      let stderr = ''
      let stdoutTruncated = false
      let stderrTruncated = false
      let timedOut = false
      let settled = false

      // shell:true 让 Node 选平台 shell(Windows:cmd.exe / POSIX:/bin/sh),命令字符串
      // 原样交给 shell 执行(allowlist 命令来自项目 TESTING.md + 任务 verification)。
      let child: ChildProcess
      try {
        child = spawn(command, {
          cwd: worktreePath,
          shell: true,
          env: process.env,
          windowsHide: true,
        })
      } catch (err) {
        // spawn 同步抛错(极罕见,如 options 非法)→ 显式 failed。
        resolve(toFailedOnSpawn(command, start, err))
        return
      }

      /** 幂等收口:清理定时器后 resolve 一次(防止 close 与 error 双触发重复 resolve)。 */
      const finish = (exitCode: number | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const durationMs = durationSince(start)
        const outputSummary = buildOutputSummary({
          stdout,
          stderr,
          stdoutTruncated,
          stderrTruncated,
          timedOut,
        })
        if (timedOut) {
          // 超时映射:failed + exitCode=null(无真实退出码)+ 摘要注明超时(契约 FR-011.4)。
          resolve({ command, result: 'failed', exitCode: null, durationMs, outputSummary })
          return
        }
        const result: VerificationResult = exitCode === 0 ? 'passed' : 'failed'
        resolve({ command, result, exitCode, durationMs, outputSummary })
      }

      // 超时定时器:SIGTERM 优雅 + 500ms 后 SIGKILL 强制(任务 §12 僵尸进程风险)。
      // 超时已判定即 finish 收口,不等 close 事件——shell 模式下孙进程(被 shell 启动的真实
      // 命令)可能持有 stdio 管道,使 close 迟迟不触发,导致 promise 卡死;settled 守卫防止
      // close 后续触发时重复 resolve。
      const timer = setTimeout(() => {
        timedOut = true
        // 杀整个进程树:Windows taskkill /T /F 清孙进程(避免 cwd 被孤儿占用);
        // POSIX SIGTERM + 兜底 SIGKILL(进程组隔离由生产环境容器保障)。
        killTree(child)
        finish(null)
      }, this.timeoutMs)

      // stdout / stderr 流式累计,各到 maxOutputBytes 截断并停止累加(任务 §8 输出上限)。
      child.stdout?.on('data', (chunk: Buffer | string) => {
        if (stdoutTruncated) return
        stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        if (stdout.length > this.maxOutputBytes) {
          stdout = stdout.slice(0, this.maxOutputBytes)
          stdoutTruncated = true
        }
      })
      child.stderr?.on('data', (chunk: Buffer | string) => {
        if (stderrTruncated) return
        stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        if (stderr.length > this.maxOutputBytes) {
          stderr = stderr.slice(0, this.maxOutputBytes)
          stderrTruncated = true
        }
      })

      // spawn 失败(ENOENT / cwd 不存在等):error 事件 → 显式 failed + 启动失败摘要。
      child.on('error', (err: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(toFailedOnSpawn(command, start, err))
      })

      // 正常 / 非零退出 / 被终止:close 携带退出码(被 kill 时 code=null → 走 failed)。
      child.on('close', (code: number | null) => {
        finish(code)
      })
    })
  }
}

/* ============================================================ *
 * 辅助:输出摘要 + 安全 kill + 耗时
 * ============================================================ */

/** buildOutputSummary 的输入(显式列举,避免参数顺序错位)。 */
interface OutputSummaryInput {
  readonly stdout: string
  readonly stderr: string
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
  readonly timedOut: boolean
}

/**
 * 合并 stdout / stderr 为受控摘要(任务 §8「输出设上限」)。
 *
 * 结构:超时标记 → stdout 段(含截断标记)→ stderr 段(含截断标记),段间空行分隔。
 * 整体超 SUMMARY_MAX_CHARS 再截断并标注,避免巨型摘要进入 result.verification。
 */
function buildOutputSummary(input: OutputSummaryInput): string {
  const parts: string[] = []
  if (input.timedOut) parts.push('执行超时(已强制终止)')
  if (input.stdout.length > 0) {
    parts.push(`stdout:\n${input.stdout}${input.stdoutTruncated ? '…[截断]' : ''}`)
  }
  if (input.stderr.length > 0) {
    parts.push(`stderr:\n${input.stderr}${input.stderrTruncated ? '…[截断]' : ''}`)
  }
  if (parts.length === 0) return ''
  const joined = parts.join('\n\n')
  if (joined.length <= SUMMARY_MAX_CHARS) return joined
  return joined.slice(0, SUMMARY_MAX_CHARS) + '…[摘要截断]'
}

/**
 * spawn 失败 / error 事件的统一映射:result='failed' + exitCode=null + 摘要注明启动失败
 * (任务 §11「spawn 失败显式返回」;不伪造 passed)。
 */
function toFailedOnSpawn(
  command: string,
  start: number,
  err: unknown,
): VerificationRunnerResult {
  const message = err instanceof Error ? err.message : String(err)
  return {
    command,
    result: 'failed',
    exitCode: null,
    durationMs: durationSince(start),
    outputSummary: `命令启动失败:${message}`,
  }
}

/** 自 start 的耗时毫秒(向下取整,最小 0,避免负值)。 */
function durationSince(start: number): number {
  return Math.max(0, Math.round(performance.now() - start))
}

/**
 * 杀整个子进程树:Windows 经 taskkill /T /F 清孙进程(shell 启动的真实命令),POSIX
 * 走 SIGTERM + 兜底 SIGKILL(任务 §12 僵尸进程风险)。
 *
 * 必要性:shell 模式下 child 是 shell(cmd.exe / /bin/sh),真实命令是孙进程;直接
 * child.kill 只杀 shell,孙进程成孤儿并持有 cwd(Windows 文件锁致 temp 目录不可删)。
 * Windows 的 taskkill /T 递归杀进程树解决此问题;POSIX 生产环境通常在容器内,进程组
 * 隔离由容器保障,此处尽力 SIGTERM/SIGKILL。
 *
 * 所有 kill 路径忽略抛错:进程可能已退出(或 PID 不可用),close/error 事件完成收口,
 * 清理路径不应抛断 promise(settled 守卫防重复 resolve)。
 */
function killTree(child: ChildProcess): void {
  const pid = child.pid
  if (pid === undefined) return
  if (process.platform === 'win32') {
    // taskkill /T 杀进程树(含孙进程),/F 强制;同步执行确保孙进程被清后释放 cwd。
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      return
    } catch {
      // taskkill 不可用(极罕见)→ 回退信号 kill。
    }
  }
  // POSIX:SIGTERM 优雅 + 300ms 宽限后 SIGKILL 强制。
  try {
    child.kill('SIGTERM')
  } catch {
    // 进程可能已退出——忽略。
  }
  setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      // 已退出——忽略。
    }
  }, 300)
}
