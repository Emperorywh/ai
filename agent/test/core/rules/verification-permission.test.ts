import { describe, expect, it } from 'vitest'
import {
  computeVerificationAllowlist,
  isVerificationGatePassed,
  overlaySystemVerification,
  resolvePathScope,
  scanCommandHeuristics,
  validateAllowlistPermissions,
  validateCommandPermissions,
} from '../../../src/core/index.js'
import type {
  CommandPermissionSpec,
  Layer,
  Permission,
  ResultVerification,
  TestingCommand,
  VerificationCommand,
} from '../../../src/core/index.js'

/* ============================================================ *
 * 测试夹具
 * ============================================================ */

/** 构造一条项目级 TESTING.md 命令声明（条件包含可选字段，避免改写 readonly 属性）。 */
function projectCmd(
  command: string,
  opts: {
    layers?: readonly Layer[]
    requires_permissions?: readonly Permission[]
  } = {},
): TestingCommand {
  return {
    command,
    ...(opts.layers !== undefined ? { layers: opts.layers } : {}),
    ...(opts.requires_permissions !== undefined
      ? { requires_permissions: opts.requires_permissions }
      : {}),
  }
}

/** 项目级 TESTING.md 全量命令总表（镜像 docs/TESTING.md）。 */
function testingCommandsFixture(): TestingCommand[] {
  return [
    projectCmd('npm run typecheck', {
      layers: ['type', 'domain', 'data', 'page'],
    }),
    projectCmd('npm test', {
      layers: ['type', 'domain', 'data', 'page'],
    }),
    projectCmd('npm run lint', {
      layers: ['type', 'domain', 'data', 'page'],
    }),
    projectCmd('npm run build', { layers: ['page'] }),
  ]
}

/* ============================================================ *
 * computeVerificationAllowlist —— layer 裁剪
 * ============================================================ */

describe('computeVerificationAllowlist：layer 裁剪', () => {
  it('layers 未声明 → 对任意 layer 生效（全 layer）', () => {
    const allowlist = computeVerificationAllowlist({
      taskLayer: 'ui',
      testingCommands: [projectCmd('npm test')],
      taskVerification: [],
    })
    expect(allowlist).toEqual([
      { command: 'npm test', source: 'project', requires_permissions: [] },
    ])
  })

  it('layers 声明 → 仅命中本 layer 的命令入选', () => {
    const allowlist = computeVerificationAllowlist({
      taskLayer: 'domain',
      testingCommands: testingCommandsFixture(),
      taskVerification: [],
    })
    // domain 命中 typecheck / test / lint（均声明 [type,domain,data,page]）；build 仅 page 被排除。
    expect(allowlist.map((c) => c.command)).toEqual([
      'npm run typecheck',
      'npm test',
      'npm run lint',
    ])
    expect(allowlist.map((c) => c.source)).toEqual([
      'project',
      'project',
      'project',
    ])
  })

  it('layers 声明但不含本 layer → 该命令被排除', () => {
    const allowlist = computeVerificationAllowlist({
      taskLayer: 'test',
      testingCommands: testingCommandsFixture(),
      taskVerification: [],
    })
    // test layer 不在任何声明 layers 中，全部排除。
    expect(allowlist).toEqual([])
  })

  it('显式空数组 layers [] → 不命中任何 layer（与 undefined 全 layer 区分）', () => {
    const allowlist = computeVerificationAllowlist({
      taskLayer: 'domain',
      testingCommands: [projectCmd('npm test', { layers: [] })],
      taskVerification: [],
    })
    expect(allowlist).toEqual([])
  })

  it('page layer 仅命中 build（验证单 layer 精确匹配）', () => {
    const allowlist = computeVerificationAllowlist({
      taskLayer: 'page',
      testingCommands: testingCommandsFixture(),
      taskVerification: [],
    })
    expect(allowlist.map((c) => c.command)).toEqual([
      'npm run typecheck',
      'npm test',
      'npm run lint',
      'npm run build',
    ])
  })
})

/* ============================================================ *
 * computeVerificationAllowlist —— 任务级覆盖与并集
 * ============================================================ */

describe('computeVerificationAllowlist：任务级覆盖与并集', () => {
  it('任务级与项目级同名命令 → 单条结果且 source 为 task（任务级优先）', () => {
    const allowlist = computeVerificationAllowlist({
      taskLayer: 'domain',
      testingCommands: [
        projectCmd('npm test', { layers: ['domain'], requires_permissions: [] }),
      ],
      taskVerification: ['npm test'],
    })
    expect(allowlist).toEqual([
      { command: 'npm test', source: 'task', requires_permissions: [] },
    ])
  })

  it('任务级覆盖时保留项目级声明的 requires_permissions（不静默放权）', () => {
    const allowlist = computeVerificationAllowlist({
      taskLayer: 'domain',
      testingCommands: [
        projectCmd('npm install', {
          layers: ['domain'],
          requires_permissions: ['install_dependencies'],
        }),
      ],
      taskVerification: ['npm install'],
    })
    expect(allowlist).toEqual([
      {
        command: 'npm install',
        source: 'task',
        requires_permissions: ['install_dependencies'],
      },
    ])
  })

  it('任务级命令无视 layer 排除（任务级优先于 layer 裁剪）', () => {
    // npm test 的 layers=[type]，task layer=domain 本应排除，但任务级显式列入。
    const allowlist = computeVerificationAllowlist({
      taskLayer: 'domain',
      testingCommands: [projectCmd('npm test', { layers: ['type'] })],
      taskVerification: ['npm test'],
    })
    expect(allowlist).toEqual([
      { command: 'npm test', source: 'task', requires_permissions: [] },
    ])
  })

  it('任务级命令匹配被 layer 排除的项目级声明 → 仍取其 requires_permissions', () => {
    const allowlist = computeVerificationAllowlist({
      taskLayer: 'domain',
      testingCommands: [
        projectCmd('npm install', {
          layers: ['page'],
          requires_permissions: ['install_dependencies', 'network_access'],
        }),
      ],
      taskVerification: ['npm install'],
    })
    expect(allowlist).toEqual([
      {
        command: 'npm install',
        source: 'task',
        requires_permissions: ['install_dependencies', 'network_access'],
      },
    ])
  })

  it('任务级裸命令（项目级无声明）→ requires_permissions 为空', () => {
    const allowlist = computeVerificationAllowlist({
      taskLayer: 'domain',
      testingCommands: [],
      taskVerification: ['echo hello'],
    })
    expect(allowlist).toEqual([
      { command: 'echo hello', source: 'task', requires_permissions: [] },
    ])
  })

  it('项目级 + 任务级取并集（互不相同的命令都入选）', () => {
    const allowlist = computeVerificationAllowlist({
      taskLayer: 'domain',
      testingCommands: [projectCmd('npm test', { layers: ['domain'] })],
      taskVerification: ['npm run lint'],
    })
    expect(allowlist).toEqual([
      { command: 'npm test', source: 'project', requires_permissions: [] },
      { command: 'npm run lint', source: 'task', requires_permissions: [] },
    ])
  })

  it('任务级 verification 内重复命令 → 去重为单条', () => {
    const allowlist = computeVerificationAllowlist({
      taskLayer: 'domain',
      testingCommands: [],
      taskVerification: ['npm test', 'npm test'],
    })
    expect(allowlist).toEqual([
      { command: 'npm test', source: 'task', requires_permissions: [] },
    ])
  })

  it('输出顺序：先项目级（TESTING.md 顺序）后任务级新增（verification 顺序）', () => {
    const allowlist = computeVerificationAllowlist({
      taskLayer: 'domain',
      testingCommands: [
        projectCmd('npm test', { layers: ['domain'] }),
        projectCmd('npm run lint', { layers: ['domain'] }),
      ],
      taskVerification: ['npm run build', 'custom-check'],
    })
    expect(allowlist.map((c) => c.command)).toEqual([
      'npm test',
      'npm run lint',
      'npm run build',
      'custom-check',
    ])
    expect(allowlist.map((c) => c.source)).toEqual([
      'project',
      'project',
      'task',
      'task',
    ])
  })

  it('空输入 → 空结果', () => {
    expect(
      computeVerificationAllowlist({
        taskLayer: 'domain',
        testingCommands: [],
        taskVerification: [],
      }),
    ).toEqual([])
  })
})

/* ============================================================ *
 * resolvePathScope —— deny 优先 / 拒绝启动
 * ============================================================ */

describe('resolvePathScope：deny 优先 + 拒绝启动', () => {
  it('无重叠 → ok:true', () => {
    expect(
      resolvePathScope(
        ['src/core/rules/verification-rules.ts'],
        ['src/application', 'src/infrastructure', 'src/cli'],
      ),
    ).toEqual({ ok: true })
  })

  it('完全相同路径 → 重叠（ok:false，拒绝启动）', () => {
    const result = resolvePathScope(
      ['src/core/enums.ts'],
      ['src/core/enums.ts'],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.overlaps).toEqual([
        { allowed: 'src/core/enums.ts', forbidden: 'src/core/enums.ts' },
      ])
      expect(result.reason).toContain('deny 优先')
    }
  })

  it('allowed 在 forbidden 子树内 → 重叠', () => {
    const result = resolvePathScope(
      ['src/core/rules/a.ts'],
      ['src/core'],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.overlaps[0]).toEqual({
        allowed: 'src/core/rules/a.ts',
        forbidden: 'src/core',
      })
    }
  })

  it('forbidden 在 allowed 子树内 → 重叠（deny 优先：任一方向重叠均拒绝）', () => {
    const result = resolvePathScope(['src/core'], ['src/core/enums.ts'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.overlaps[0]).toEqual({
        allowed: 'src/core',
        forbidden: 'src/core/enums.ts',
      })
    }
  })

  it('同级目录（兄弟）不构成重叠 → ok:true', () => {
    expect(resolvePathScope(['src/core/rules'], ['src/core/schemas'])).toEqual({
      ok: true,
    })
  })

  it('路径段边界：src/foo 与 src/foo-bar 是兄弟，不重叠', () => {
    // 裸字符串前缀会误判，按路径段比较须判 ok。
    expect(resolvePathScope(['src/foo'], ['src/foo-bar'])).toEqual({ ok: true })
  })

  it('规范化：反斜杠 / 尾部斜杠统一后判定重叠', () => {
    const result = resolvePathScope(
      ['src\\core\\rules\\a.ts'],
      ['src/core/'],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.overlaps[0]).toEqual({
        allowed: 'src/core/rules/a.ts',
        forbidden: 'src/core',
      })
    }
  })

  it('空路径（规范化后为空）跳过，不计入重叠', () => {
    expect(resolvePathScope(['', '   '], ['src/core'])).toEqual({ ok: true })
  })

  it('多组重叠全部上报', () => {
    const result = resolvePathScope(
      ['src/core', 'src/application'],
      ['src/core/enums.ts', 'src/application/index.ts'],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.overlaps).toHaveLength(2)
    }
  })

  it('两边皆空 → ok:true', () => {
    expect(resolvePathScope([], [])).toEqual({ ok: true })
  })
})

/* ============================================================ *
 * validateCommandPermissions —— requires_permissions ⊆ permissions
 * ============================================================ */

describe('validateCommandPermissions：requires_permissions 覆盖校验', () => {
  /** 简化命令构造。 */
  function cmd(
    command: string,
    requires_permissions: readonly Permission[] = [],
  ): CommandPermissionSpec {
    return { command, requires_permissions }
  }

  it('requires_permissions 全部被覆盖 → ok:true', () => {
    expect(
      validateCommandPermissions(cmd('npm install', ['install_dependencies']), [
        'install_dependencies',
      ]),
    ).toEqual({ ok: true })
  })

  it('requires_permissions 未被覆盖 → ok:false + missing', () => {
    const result = validateCommandPermissions(
      cmd('npm install', ['install_dependencies']),
      [],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toEqual(['install_dependencies'])
      expect(result.reason).toContain('npm install')
    }
  })

  it('部分未覆盖 → missing 只含缺失项', () => {
    const result = validateCommandPermissions(
      cmd('deploy', ['install_dependencies', 'network_access']),
      ['install_dependencies'],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toEqual(['network_access'])
    }
  })

  it('requires_permissions 为空 → ok:true（allowlist 命令执行授权自动获得）', () => {
    expect(validateCommandPermissions(cmd('npm test', []), [])).toEqual({
      ok: true,
    })
  })

  it('不检查 run_commands（验证命令自动获得执行授权）', () => {
    // 任务 permissions 不含 run_commands，命令 requires_permissions 也为空 → 仍 ok。
    expect(
      validateCommandPermissions(cmd('npm test', []), ['read_files']),
    ).toEqual({ ok: true })
  })

  it('任务 permissions 为超集 → ok:true', () => {
    expect(
      validateCommandPermissions(cmd('npm install', ['install_dependencies']), [
        'install_dependencies',
        'network_access',
        'run_commands',
      ]),
    ).toEqual({ ok: true })
  })
})

/* ============================================================ *
 * scanCommandHeuristics —— 仅 warning，不授权
 * ============================================================ */

describe('scanCommandHeuristics：启发式扫描（仅告警）', () => {
  /** 断言某能力出现在扫描告警的建议集合中。 */
  function suggests(
    warnings: ReturnType<typeof scanCommandHeuristics>,
    perm: Permission,
  ): boolean {
    return warnings.some((w) => w.suggested_permissions.includes(perm))
  }

  it('npm install → 建议 install_dependencies', () => {
    expect(
      suggests(scanCommandHeuristics('npm install'), 'install_dependencies'),
    ).toBe(true)
  })

  it('pnpm add pkg → 建议 install_dependencies', () => {
    expect(
      suggests(scanCommandHeuristics('pnpm add zod'), 'install_dependencies'),
    ).toBe(true)
  })

  it('curl → 建议 network_access', () => {
    expect(
      suggests(
        scanCommandHeuristics('curl https://example.com'),
        'network_access',
      ),
    ).toBe(true)
  })

  it('npm start → 建议 start_dev_server', () => {
    expect(
      suggests(scanCommandHeuristics('npm start'), 'start_dev_server'),
    ).toBe(true)
  })

  it('rm -rf → 建议 delete_files', () => {
    expect(
      suggests(scanCommandHeuristics('rm -rf dist'), 'delete_files'),
    ).toBe(true)
  })

  it('命令链同时命中多条规则 → 多条 warning', () => {
    const warnings = scanCommandHeuristics('npm install && rm -rf dist')
    expect(suggests(warnings, 'install_dependencies')).toBe(true)
    expect(suggests(warnings, 'delete_files')).toBe(true)
    expect(warnings.length).toBeGreaterThanOrEqual(2)
  })

  it('普通命令无匹配 → 空告警', () => {
    expect(scanCommandHeuristics('npm run typecheck')).toEqual([])
  })

  it('告警结构包含 command / suggested_permissions / reason', () => {
    const warnings = scanCommandHeuristics('npm install')
    expect(warnings.length).toBeGreaterThan(0)
    const w = warnings[0]
    if (w === undefined) throw new Error('应至少一条告警')
    expect(w.command).toBe('npm install')
    expect(w.suggested_permissions).toContain('install_dependencies')
    expect(w.reason).toBeTruthy()
  })
})

/* ============================================================ *
 * 集成：启发式告警不影响授权（§12 风险点）
 * ============================================================ */

describe('集成：启发式扫描不参与授权', () => {
  it('命令未声明 requires_permissions 时，即便启发式告警，validateCommandPermissions 仍 ok', () => {
    // 场景：命令 "npm install" 漏声明 requires_permissions，任务也无 install_dependencies。
    // 启发式会告警，但授权只看显式声明 → 校验通过（执行授权由 allowlist 自动获得）。
    const command: CommandPermissionSpec = {
      command: 'npm install',
      requires_permissions: [],
    }
    const taskPermissions: Permission[] = []

    const warnings = scanCommandHeuristics(command.command)
    const permissionResult = validateCommandPermissions(command, taskPermissions)

    // 启发式确实提示了 install_dependencies。
    expect(
      warnings.some((w) =>
        w.suggested_permissions.includes('install_dependencies'),
      ),
    ).toBe(true)
    // 但授权判定不读启发式 → 通过。
    expect(permissionResult).toEqual({ ok: true })
  })

  it('命令显式声明 requires_permissions 且任务未覆盖 → 拒绝（与启发式无关）', () => {
    const command: CommandPermissionSpec = {
      command: 'npm install',
      requires_permissions: ['install_dependencies'],
    }
    const result = validateCommandPermissions(command, [])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toEqual(['install_dependencies'])
    }
  })

  it('完整 allowlist 流水线：裁剪 → 取 requires_permissions → 校验', () => {
    // page 任务：build 命令无额外权限；install 命令声明 install_dependencies 需校验。
    const allowlist = computeVerificationAllowlist({
      taskLayer: 'page',
      testingCommands: [
        projectCmd('npm run build', { layers: ['page'] }),
        projectCmd('npm install', {
          layers: ['page'],
          requires_permissions: ['install_dependencies'],
        }),
      ],
      taskVerification: [],
    })
    const installCmd = allowlist.find((c) => c.command === 'npm install')
    if (installCmd === undefined) throw new Error('install 命令应在 allowlist 中')

    // 任务未声明 install_dependencies → 校验失败。
    const result = validateCommandPermissions(installCmd, [])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toEqual(['install_dependencies'])
    }
    // build 命令 requires_permissions 为空 → 校验通过。
    const buildCmd = allowlist.find((c) => c.command === 'npm run build')
    if (buildCmd === undefined) throw new Error('build 命令应在 allowlist 中')
    expect(validateCommandPermissions(buildCmd, [])).toEqual({ ok: true })
  })
})

/* ============================================================ *
 * validateAllowlistPermissions —— allowlist 批量权限校验（TASK-039 / FR-011.3）
 * ============================================================ */

describe('validateAllowlistPermissions：allowlist 批量权限校验', () => {
  /** 构造 CommandPermissionSpec（结构兼容 VerificationCommand）。 */
  function spec(command: string, requires: readonly Permission[] = []): CommandPermissionSpec {
    return { command, requires_permissions: requires }
  }

  it('全部覆盖 → ok:true', () => {
    expect(
      validateAllowlistPermissions(
        [spec('npm install', ['install_dependencies']), spec('npm test')],
        ['install_dependencies'],
      ),
    ).toEqual({ ok: true })
  })

  it('部分未覆盖 → ok:false + denied 只含缺失命令与缺失能力', () => {
    const result = validateAllowlistPermissions(
      [spec('npm test'), spec('npm install', ['install_dependencies']), spec('deploy', ['network_access'])],
      ['install_dependencies'],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.denied).toEqual([{ command: 'deploy', missing: ['network_access'] }])
    }
  })

  it('全部未覆盖 → denied 含全部', () => {
    const result = validateAllowlistPermissions(
      [spec('a', ['network_access']), spec('b', ['delete_files'])],
      [],
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.denied).toHaveLength(2)
  })

  it('空 requires_permissions → ok:true（allowlist 命令执行授权自动获得）', () => {
    expect(
      validateAllowlistPermissions([spec('npm test'), spec('npm run lint')], []),
    ).toEqual({ ok: true })
  })

  it('空 allowlist → ok:true', () => {
    expect(
      validateAllowlistPermissions([], ['install_dependencies']),
    ).toEqual({ ok: true })
  })
})

/* ============================================================ *
 * overlaySystemVerification —— 系统记录覆盖模型自报（TASK-039 / FR-011.5）
 * ============================================================ */

describe('overlaySystemVerification：系统记录覆盖模型自报', () => {
  /** 构造 ResultVerification（默认 source='system'，模型场景显式传 'model'）。 */
  function mkRec(opts: {
    command: string
    result: 'passed' | 'failed' | 'skipped'
    source?: 'model' | 'system'
    exitCode?: number | null
    durationMs?: number
    outputSummary?: string
    notes?: string
  }): ResultVerification {
    return {
      command: opts.command,
      result: opts.result,
      notes: opts.notes ?? '',
      source: opts.source ?? 'system',
      exit_code: opts.exitCode ?? null,
      duration_ms: opts.durationMs ?? 0,
      output_summary: opts.outputSummary ?? '',
    }
  }

  it('同命令系统记录覆盖模型自报（模型 passed 被系统 failed 取代）', () => {
    const model = [mkRec({ command: 'npm test', result: 'passed', source: 'model' })]
    const system = [
      mkRec({
        command: 'npm test',
        result: 'failed',
        source: 'system',
        exitCode: 1,
        durationMs: 120,
        outputSummary: 'stderr 摘要',
      }),
    ]
    const merged = overlaySystemVerification(model, system)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.result).toBe('failed')
    expect(merged[0]?.source).toBe('system')
    expect(merged[0]?.exit_code).toBe(1)
    expect(merged[0]?.duration_ms).toBe(120)
  })

  it('模型独有命令保留（系统未执行该命令，保留供审计但不参与门禁）', () => {
    const model = [mkRec({ command: 'extra', result: 'passed', source: 'model' })]
    const system = [mkRec({ command: 'npm test', result: 'passed' })]
    const merged = overlaySystemVerification(model, system)
    expect(merged.map((m) => m.command)).toEqual(['npm test', 'extra'])
    expect(merged[1]?.source).toBe('model')
  })

  it('系统独有命令加入（模型未自报）', () => {
    const merged = overlaySystemVerification([], [
      mkRec({ command: 'npm test', result: 'passed' }),
    ])
    expect(merged).toHaveLength(1)
  })

  it('顺序：先系统记录（runner 执行顺序）后未覆盖模型记录', () => {
    const model = [
      mkRec({ command: 'a', result: 'passed', source: 'model' }),
      mkRec({ command: 'b', result: 'passed', source: 'model' }),
    ]
    const system = [mkRec({ command: 'c', result: 'passed' })]
    expect(overlaySystemVerification(model, system).map((m) => m.command)).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('模型与系统全同命令 → 只保留系统记录（去重）', () => {
    const model = [mkRec({ command: 'x', result: 'passed', source: 'model' })]
    const system = [mkRec({ command: 'x', result: 'failed' })]
    expect(overlaySystemVerification(model, system)).toHaveLength(1)
  })

  it('双空 → 空', () => {
    expect(overlaySystemVerification([], [])).toEqual([])
  })
})

/* ============================================================ *
 * isVerificationGatePassed —— 完成门禁（TASK-039 / FR-012 / §11）
 * ============================================================ */

describe('isVerificationGatePassed：完成门禁（allowlist 命令须全 passed）', () => {
  /** 构造 allowlist 命令（VerificationCommand）。 */
  function cmd(command: string): VerificationCommand {
    return { command, source: 'project', requires_permissions: [] }
  }

  /** 构造系统记录（默认 source='system'）。 */
  function sys(command: string, result: 'passed' | 'failed' | 'skipped'): ResultVerification {
    return { command, result, notes: '', source: 'system', exit_code: 0, duration_ms: 10, output_summary: '' }
  }

  it('全部 passed → ok:true', () => {
    const allowlist = [cmd('npm test'), cmd('npm run lint')]
    const records = [sys('npm test', 'passed'), sys('npm run lint', 'passed')]
    expect(isVerificationGatePassed(allowlist, records)).toEqual({ ok: true })
  })

  it('有 failed → ok:false + failed 清单', () => {
    const allowlist = [cmd('npm test')]
    const records = [sys('npm test', 'failed')]
    const result = isVerificationGatePassed(allowlist, records)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failed).toHaveLength(1)
      expect(result.notRun).toEqual([])
    }
  })

  it('有 skipped → ok:false（不再把任意 skipped 当作通过，§11）', () => {
    const allowlist = [cmd('npm test')]
    const records = [sys('npm test', 'skipped')]
    expect(isVerificationGatePassed(allowlist, records).ok).toBe(false)
  })

  it('allowlist 命令无系统记录（未执行）→ ok:false + notRun（未执行不能伪装 passed）', () => {
    const allowlist = [cmd('npm test'), cmd('npm run lint')]
    const records = [sys('npm test', 'passed')]
    const result = isVerificationGatePassed(allowlist, records)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.notRun).toEqual(['npm run lint'])
  })

  it('空 allowlist → ok:true（无可验证命令）', () => {
    expect(isVerificationGatePassed([], [])).toEqual({ ok: true })
  })

  it('失败与未执行并存 → ok:false 同时含 failed 与 notRun', () => {
    const allowlist = [cmd('a'), cmd('b'), cmd('c')]
    const records = [sys('a', 'passed'), sys('b', 'failed')]
    const result = isVerificationGatePassed(allowlist, records)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failed).toHaveLength(1)
      expect(result.notRun).toEqual(['c'])
    }
  })
})
