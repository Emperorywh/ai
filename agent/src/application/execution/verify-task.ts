/**
 * 单任务系统验证 Application 用例（串行编排 SPEC §10 验证规则 FR-011 / FR-012 / §20.2）。
 *
 * 把「Executor 完成后系统独立执行验证 allowlist」抽取为 application 层用例，为串行 Orchestrator（TASK-044）提供稳定、可测试的系统验证入口：
 *   `allowlist 计算 → 权限校验 → 串行 Runner → 系统记录覆盖模型自报 → 完成门禁`
 *
 * 职责边界（任务 §2 / §9 / §11）：
 *   - 负责「系统验证阶段」全链：computeVerificationAllowlist（layer 裁剪 + 任务级并集）→ validateAllowlistPermissions
 *     （权限不足直接 blocked + needs-human，Runner 不被调用，§11 验收）→ 严格串行调 VerificationRunnerPort（allowlist 顺序）→
 *     overlaySystemVerification（系统记录覆盖模型自报）→ isVerificationGatePassed（完成门禁：allowlist 命令系统记录必须全部 passed）。
 *   - **不负责执行子进程命令**（§7「不实现子进程命令执行」，留给 TASK-040）：Runner 由调用方注入，
 *     本用例只编排；也不负责状态流转与合并——门禁结果以结构化 outcome 交回调用方（Orchestrator / Finalize）。
 *
 * 完成门禁语义（FR-012 / §11 验收）：
 *   - 门禁只认 allowlist 命令的系统记录（source='system'）：模型自报的 passed 不算数，未执行命令不能伪装 passed。
 *   - allowlist 每条命令的系统记录必须 result === 'passed'；任意 failed / skipped / 未执行 → blocked（no_review 任务至此不进入 done）。
 *   - 权限缺失（requires_permissions 未被覆盖）→ 直接 blocked + needs-human，Runner 不被调用（§8「权限缺失返回结构化结果，不静默跳过」）。
 *
 * 依赖方向（ARCHITECTURE.md §3 / §4 / 任务 §8）：`cli → application ← infrastructure`。
 *   - 本用例只依赖 core 领域规则（computeVerificationAllowlist / validateAllowlistPermissions / overlaySystemVerification /
 *     isVerificationGatePassed）+ application Port（VerificationRunnerPort），零 infrastructure 实现类导入。
 *   - Runner 经 Port 注入（TASK-040 由 infrastructure 提供真实 shell 实现，测试以 fake Runner 注入），
 *     用例不感知子进程 / Node child_process / shell 细节。
 *
 * 权威来源：串行编排 SPEC FR-011（系统执行验证）/ FR-012（验证失败）/ §20.2（模块边界）/ §20.3（Ports）。
 */
import type {
  DeniedCommand,
  Issue,
  Layer,
  Permission,
  ResultVerification,
  TaskId,
  TestingCommand,
} from '../../core/index.js'
import {
  computeVerificationAllowlist,
  isVerificationGatePassed,
  overlaySystemVerification,
  validateAllowlistPermissions,
} from '../../core/index.js'
import type { VerificationRunnerPort } from './ports.js'

/* ============================================================ *
 * 用例依赖（Ports）与输入输出
 * ============================================================ */

/**
 * VerifyTaskUseCase 的注入依赖（任务 §2「经 Ports 注入」/ §11「fake Runner 覆盖 passed/failed/skipped/退出码/超时」）。
 *
 * runner：系统验证执行 Port，在 worktree 内真实执行单条验证命令、采集真实退出码 / 耗时 / 输出摘要
 * （契约见 execution/ports.ts）。本任务只定义契约，真实实现（TASK-040）与 fake（测试）由调用方注入。
 */
export interface VerifyTaskPorts {
  /** 系统验证执行 Port：在 worktree 内执行单条验证命令。 */
  readonly runner: VerificationRunnerPort
}

/** VerifyTaskUseCase.verify 的调用参数（每次验证可能不同，由调用方组装）。 */
export interface VerifyTaskInput {
  /** 当前任务 id（issue created_from_task 用）。 */
  readonly taskId: TaskId
  /** worktree 绝对路径（runner 在此目录内执行验证命令）。 */
  readonly worktreePath: string
  /** 当前任务 layer（裁剪项目级命令用）。 */
  readonly taskLayer: Layer
  /** 任务 frontmatter 声明的能力（校验 requires_permissions 用）。 */
  readonly taskPermissions: readonly Permission[]
  /** 任务级 frontmatter verification（裸命令行字符串数组，并集用）。 */
  readonly taskVerification: readonly string[]
  /** 项目级 TESTING.md 全部命令声明（裁剪前的全集）。 */
  readonly testingCommands: readonly TestingCommand[]
  /** 模型自报的 verification 记录（从 worktree 内 .result.md 读取，被系统记录覆盖）。 */
  readonly modelVerification: readonly ResultVerification[]
}

/**
 * VerifyTaskUseCase 的结构化结果（任务 §9「用例返回结构化阶段结果」）。
 *
 * 携带合并阶段（FinalizeTaskUseCase）/ Orchestrator 所需的系统验证事实：
 *   - status / nextAction：门禁结论——passed（allowlist 全 passed，可继续 review / done）/ blocked（权限不足或验证失败，需人工）。
 *   - verification：系统记录覆盖模型自报后的最终记录（写回 .result.md 的 verification）。
 *   - deniedCommands：权限不足命令清单（blocked 原因之一）。
 *   - proposedIssues：blocked 时提议的 ISSUES 项（id 留空，Orchestrator 回写分配 ISS-XXX）。
 *   - failureReason：blocked 时的可读原因摘要。
 */
export interface VerifyTaskOutcome {
  /** 当前任务 id。 */
  readonly taskId: TaskId
  /** 门禁结论：passed（全 passed）/ blocked（权限不足或验证失败）。 */
  readonly status: 'passed' | 'blocked'
  /** 建议下一步：passed → review（继续审查 / no_review done 由上层定）；blocked → needs-human。 */
  readonly nextAction: 'review' | 'needs-human'
  /** 系统记录覆盖模型自报后的最终 verification（写回 .result.md）。 */
  readonly verification: readonly ResultVerification[]
  /** 权限不足命令清单（status='blocked' 时非空）。 */
  readonly deniedCommands: readonly DeniedCommand[]
  /** blocked 时提议的 ISSUES 项（id 留空）；passed 时为空数组。 */
  readonly proposedIssues: readonly Issue[]
  /** blocked 时的可读原因摘要（失败 / 跳过 / 未执行命令清单）；passed 时为 undefined。 */
  readonly failureReason?: string
}

/* ============================================================ *
 * 用例实现
 * ============================================================ */

/**
 * 单任务系统验证用例（FR-011 / FR-012 / §20.2）。
 *
 * 构造注入 VerifyTaskPorts（CLI / Orchestrator wiring）；每次 verify 读取调用方组装的输入，驱动一次完整系统验证阶段。用例不持有跨调用状态——纯编排，状态权威在 main 仓储 frontmatter，写回由调用方负责。
 *
 * 内部组合 core 纯规则（computeVerificationAllowlist / validateAllowlistPermissions / overlaySystemVerification /
 * isVerificationGatePassed）+ VerificationRunnerPort——全部复用领域规则与 Port，不重复实现 allowlist 计算 / 权限校验 / 覆盖合并 / 门禁判定（任务 §8）。
 */
export class VerifyTaskUseCase {
  constructor(private readonly ports: VerifyTaskPorts) {}

  /**
   * 执行单个任务的「系统验证阶段」（不合并、不状态流转）。
   *
   * 阶段顺序（§9 数据流 / §11 验收）：
   *   1. computeVerificationAllowlist：layer 裁剪 + 任务级并集 → 最终 allowlist。
   *   2. validateAllowlistPermissions：权限不足 → 直接 blocked + needs-human，Runner 不被调用（§11）。
   *   3. （权限全通过）严格串行 await runner.run（allowlist 顺序，§11「严格串行且顺序确定」）→ 收集系统记录（source='system'）。
   *   4. overlaySystemVerification：系统记录覆盖模型自报 → 最终 verification。
   *   5. isVerificationGatePassed：allowlist 命令系统记录必须全部 passed；任一 failed / skipped / 未执行 → blocked。
   *
   * @returns VerifyTaskOutcome 携带 status / nextAction / verification / deniedCommands / proposedIssues / failureReason。
   */
  async verify(input: VerifyTaskInput): Promise<VerifyTaskOutcome> {
    const { taskId, worktreePath } = input

    // 1. 计算最终 allowlist（layer 裁剪项目级 + 任务级并集，§16）。
    const allowlist = computeVerificationAllowlist({
      taskLayer: input.taskLayer,
      testingCommands: input.testingCommands,
      taskVerification: input.taskVerification,
    })

    // 2. 批量校验 requires_permissions；缺失 → Runner 不被调用，直接 blocked + needs-human（§11 / §8 结构化结果）。
    const perm = validateAllowlistPermissions(allowlist, input.taskPermissions)
    if (!perm.ok) {
      const skippedRecords: ResultVerification[] = allowlist.map((cmd) => ({
        command: cmd.command,
        result: 'skipped',
        notes: '权限不足，Runner 未被调用',
        source: 'system',
        exit_code: null,
        duration_ms: 0,
        output_summary: '',
      }))
      const verification = overlaySystemVerification(input.modelVerification, skippedRecords)
      return {
        taskId,
        status: 'blocked',
        nextAction: 'needs-human',
        verification,
        deniedCommands: perm.denied,
        proposedIssues: [buildPermissionIssue(taskId, perm.denied)],
        failureReason: `验证命令权限不足：${perm.denied.map((d) => d.command).join('; ')}`,
      }
    }

    // 3. 严格串行调 Runner（allowlist 顺序，逐条 await；§11「严格串行且顺序确定」），收系统记录（source='system' + 四元组写全）。
    const systemRecords: ResultVerification[] = []
    for (const cmd of allowlist) {
      const r = await this.ports.runner.run({ command: cmd.command, worktreePath })
      systemRecords.push({
        command: r.command,
        result: r.result,
        notes: '',
        source: 'system',
        exit_code: r.exitCode,
        duration_ms: r.durationMs,
        output_summary: r.outputSummary,
      })
    }

    // 4. 系统统记录覆盖同命令模型自报（FR-011.5），产出最终 verification。
    const verification = overlaySystemVerification(input.modelVerification, systemRecords)

    // 5. 完成门禁：allowlist 命令的系统记录必须全部 passed（§11「未执行命令不能伪装 passed」「不再把任意 skipped 当作通过」）。
    const gate = isVerificationGatePassed(allowlist, systemRecords)
    if (gate.ok) {
      return {
        taskId,
        status: 'passed',
        nextAction: 'review',
        verification,
        deniedCommands: [],
        proposedIssues: [],
      }
    }

    // 门禁不通过：产 blocked + needs-human + 验证失败 issue（失败 / 跳过 / 未执行）。
    const failedSummary = gate.failed.map((r) => `${r.command}=${r.result}`).join('; ')
    const notRunSummary = gate.notRun.join('; ')
    return {
      taskId,
      status: 'blocked',
      nextAction: 'needs-human',
      verification,
      deniedCommands: [],
      proposedIssues: [buildVerificationFailureIssue(taskId, gate)],
      failureReason: [
        failedSummary ? `失败/跳过：${failedSummary}` : '',
        notRunSummary ? `未执行：${notRunSummary}` : '',
      ]
        .filter((s) => s.length > 0)
        .join('；'),
    }
  }
}

/* ============================================================ *
 * 领域辅助：ISSUES 提议项构造（blocked 时，id 留空待 Orchestrator 分配）
 * ============================================================ */

/**
 * 构造「验证命令权限不足」ISSUES 提议项（§8 结构化结果 / FR-039）。
 *
 * severity='high'：权限不足直接阻断验证，需人工扩权或调整 requires_permissions。id 留空，由 Orchestrator 回写分配 ISS-XXX。
 */
function buildPermissionIssue(taskId: TaskId, denied: readonly DeniedCommand[]): Issue {
  const detail = denied
    .map((d) => `${d.command}（缺 ${d.missing.join(',')}）`)
    .join('; ')
  return {
    id: '',
    title: '系统验证命令权限不足，Runner 未执行',
    status: 'open',
    severity: 'high',
    scope: 'verification',
    created_from_task: taskId,
    owner: '',
    recommended_action: `为任务声明缺失的能力或调整命令 requires_permissions 后重跑：${detail}`,
  }
}

/**
 * 构造「系统验证未通过」ISSUES 提议项（FR-012 / §11）。
 *
 * severity='high'：验证失败阻断合并，需人工修复失败项。failed 含 result !== 'passed' 的系统记录，notRun 含无系统记录的命令。
 */
function buildVerificationFailureIssue(
  taskId: TaskId,
  gate: { readonly failed: readonly ResultVerification[]; readonly notRun: readonly string[] },
): Issue {
  const failedDetail = gate.failed.map((r) => `${r.command}=${r.result}`).join('; ')
  const notRunDetail = gate.notRun.join('; ')
  const detail = [
    failedDetail ? `失败/跳过：${failedDetail}` : '',
    notRunDetail ? `未执行：${notRunDetail}` : '',
  ]
    .filter((s) => s.length > 0)
    .join('；')
  return {
    id: '',
    title: '系统验证未通过，禁止合并',
    status: 'open',
    severity: 'high',
    scope: 'verification',
    created_from_task: taskId,
    owner: '',
    recommended_action: `修复失败的验证项后重跑系统验证：${detail}`,
  }
}
