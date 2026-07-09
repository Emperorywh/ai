---
task_id: TASK-018
execution_status: completed
modified_files:
  - src/infrastructure/index.ts
created_files:
  - src/infrastructure/git/worktree-adapter.ts
  - test/infrastructure/git/worktree-adapter.test.ts
deleted_files: []
execution_commits: []
verification:
  - command: npm run typecheck
    result: passed
    notes: 0 错误（strict + noUncheckedIndexedAccess）
  - command: npm test -- infrastructure/git/worktree-adapter
    result: passed
    notes: 19 项集成单测全绿（临时 git 仓库，WorktreeAdapter 7 + GitMergeAdapter 12）
  - command: npm run lint
    result: passed
    notes: eslint 无报错
  - command: npm test
    result: passed
    notes: 全量回归 489 项全绿（Node 22 ABI 127，含 SQLite）
global_update_requests:
  progress:
    - section: 当前完成到哪个任务
      mode: replace
      content: |
        - TASK-018（Infra Git worktree 与 merge 原语适配器）已完成：`src/infrastructure/git/worktree-adapter.ts` 提供 `WorktreeAdapter`（`create`/`reset`/`retain`/`remove`）+ `GitMergeAdapter`（`rebaseOnto`/`fastForwardMain`/`collectPostRebaseCommits`/`commitAuditResult`/`branchMerged`/`abortOrCleanRebase`/`listConflicts`），通过子进程调系统 git（spawnSync）实现，子进程错误统一转 `GitAdapterError`（含命令 / 退出码 / stderr），19 项集成单测（临时 git 仓库）。结构兼容 application 层 `WorktreePort` / `GitMergePort`（无需显式 implements），为 TASK-019 rebase-ff / TASK-021 幂等恢复 / TASK-026 task:run 提供 git 底层原语。
    - section: 当前系统可用能力
      mode: replace
      content: |
        - Git worktree 生命周期与合并原语：`WorktreeAdapter(mainRepoDir, worktreesDir)`（`src/infrastructure/git/worktree-adapter.ts`）经系统 git 子进程管理 worktree——`create(mainRef, taskId)` 基于基线创建 worktree + 分支 `task/TASK-XXX` 返回绝对路径（基线解析为 commit hash 记入内存 Map 供 reset）；`reset(taskId)` 回到 create 记录的基线（`reset --hard` + `clean -fd`，保留被忽略文件如 node_modules，§12）；`retain(taskId)` 显式保留 no-op；`remove(taskId)` 回收 worktree + 分支（existsSync + rev-parse --verify 守卫幂等）。`GitMergeAdapter(mainRepoDir, worktreesDir)` 提供合并原语——`rebaseOnto(taskId, mainRef)` 冲突不抛断（isRebaseInProgress 探测中间态区分冲突停顿 vs 真错误，留 listConflicts 探测）；`fastForwardMain(taskId, mainRef)` 用 `merge-base --is-ancestor` 验证 ff 可行 + `update-ref refs/heads/<mainRef>` 移动 ref（绝不产生 merge commit，§3.2，不切换工作区）；`collectPostRebaseCommits(taskId, baseRef)` 用 \x1f/\x1e 分隔 --reverse 时间正序采集 post-rebase 实现 commit 元信息（去首尾换行）；`commitAuditResult(taskId, resultPath)` 提交独立 workflow audit commit（§3.2）；`branchMerged(taskId, mainRef)` 等价 `--is-ancestor` 判定幂等恢复；`abortOrCleanRebase(taskId)` 幂等清理；`listConflicts(taskId)` 列 unmerged 文件。`GitAdapterError` 封装失败命令 / 退出码 / stderr 供上层显式处理（§12）。两适配器构造同形（mainRepoDir + worktreesDir），由 CLI composition root wiring 注入，不承载业务规则（合并顺序 / 回填时机 / 冲突仲裁归 application TASK-019/021）。
  decisions:
    - id: ""
      title: "Git 适配器设计——子进程调 git + GitAdapterError 领域错误、create 记录基线 commit、reset clean -fd 保留 node_modules、fastForwardMain 用 update-ref 避免 merge commit、rebase 冲突不抛断、collect 用 \x1f/\x1e 分隔去换行、abort 幂等"
      status: proposed
      scope: infrastructure/git/worktree-adapter
      created_from_task: TASK-018
      decision: "TASK-018 对 §3.2 / §7 / §8 / §12 与 ARCHITECTURE §4 未明文的 git 适配设计作如下解释并落地：（1）通过 spawnSync 调系统 git，不引入重型 git 库（§8「不引入重型 git 库」），同步风格与 frontmatter-parser / task-doc-repo 一致。（2）子进程错误统一转 GitAdapterError（含 command / exitCode / stderr），区分「spawn 自身失败（找不到 git / cwd 不存在）→ 抛 Error」与「git 业务退出码非 0 → 抛 GitAdapterError」（§12，AGENTS §4 不静默）。（3）create 把 mainRef 经 `rev-parse` 解析为绝对 commit hash 记入 bases Map，reset 据此精确回基线——即便 main 后续已变也回到原基线（§7「从干净状态重跑」）；内存 Map 单进程内有效，跨进程恢复靠 git 状态 + frontmatter（§3.2，见 ISS-008）。（4）reset 用 `reset --hard <base>` + `clean -fd`（不含 -x）——保留被忽略文件如 node_modules（§12「node_modules 不归本适配器」，依赖复用归 CLI TASK-026）。（5）remove 幂等：worktree remove 与 branch -D 各自用 existsSync / rev-parse --verify 守卫，不依赖 stderr 文本判定（规避 Windows / 本地化 stderr 差异）。（6）fastForwardMain 先 `merge-base --is-ancestor <mainRef> <branch>` 验证 ff 可行（不可则抛 GitAdapterError「需先 rebase」），再 `update-ref refs/heads/<mainRef> <branch>` 移动 ref——直接移动 ref 不切换工作区、绝不产生 merge commit（§3.2）；假定 mainRef 为短分支名（如 main），构造 refs/heads/<mainRef>。（7）rebaseOnto 用 tryGit 不抛，冲突时 rebase 停在中间态（退出码非 0），isRebaseInProgress 探测 rebase-merge / rebase-apply 目录区分「冲突停顿（静默返回，留 listConflicts 探测）」与「真错误（抛 GitAdapterError）」（GitMergePort.rebaseOnto 契约「冲突不抛断」，TASK-019 §2）。（8）collectPostRebaseCommits 用 `--format=%H\\x1f%s\\x1f%an\\x1f%aI\\x1e` + `--reverse` 时间正序，\\x1f 分隔字段、\\x1e 分隔记录规避 message 含换行干扰，解析时去每条记录首尾换行（git --format 每条后追加 \\n 导致下一条首部残留 \\n）。（9）abortOrCleanRebase 幂等：tryGit `rebase --abort`，无进行中的 rebase 时 git 报错被静默，仍有中间态却失败才抛错（§3.2「丢弃不完整 rebase」）。（10）两适配器构造同形（mainRepoDir + worktreesDir），CLI composition root wiring 时一并注入；模块级辅助 branchName / rawExec / runGit / tryGit / isRebaseInProgress 共用不复制粘贴（AGENTS §3）。结构兼容 WorktreePort / GitMergePort 无需显式 implements（ARCHITECTURE §4）。"
      rationale: "子进程调 git 而非引入 isomorphic-git / simple-git：§8 明文「不引入重型 git 库」，且 git CLI 行为是事实来源（worktree / rebase / update-ref 语义清晰、与 §3.2 描述一一对应）。GitAdapterError 封装 stderr：§12「子进程错误需捕获并转为领域错误」，上层据 stderr / exitCode 显式分派（冲突 vs 分叉 vs ref 不存在），比裸 Error 字符串匹配稳健。create 记录 commit hash 而非 ref：main 是移动 ref，reset 需回到「创建时的基线」而非「当前 main」（§7 重跑同一基线），hash 是不可变锚点。clean -fd 不含 -x：被忽略文件（node_modules）是依赖产物，reset 重跑需复用而非重装（§12 明确 node_modules 归 CLI 层处理）。remove 幂等用 existsSync + rev-parse：stderr 文本随 locale / git 版本变（Windows 可能本地化），结构化判定更可靠。fastForwardMain 用 update-ref：`git checkout main && git merge --ff-only` 会切换主工作区（副作用，Orchestrator 在主分支维护状态时危险），update-ref 只移动 ref 不动工作区且原子；先验 is-ancestor 保证线性（非 ff 抛错，避免误产生 merge commit）。rebaseOnto 区分冲突停顿：git rebase 冲突退出码非 0 与 ref 无效等真错误同为非 0，靠 isRebaseInProgress（探测 rebase-merge/rebase-apply 中间态目录）精确区分，落实 Port「冲突不抛断」契约。collect 用 \\x1f/\\x1e：commit message 可含空格 / 括号 / 换行（%B），用 ASCII 控制字符作分隔避免与 message 内容冲突，--reverse 时间正序符合审计直觉。abortOrCleanRebase 幂等：§3.2 恢复逻辑可能多次调用 abort（已无 rebase 也调），git rebase --abort 无 rebase 时报错需静默，但若 abort 后仍处中间态说明异常须抛。"
      consequences: "TASK-019 rebase-ff 合并编排经 GitMergePort 调 rebaseOnto（冲突不抛断→listConflicts→转 blocked）+ collectPostRebaseCommits（rebase 后回填 execution_commits）+ commitAuditResult（audit commit）+ fastForwardMain（ff 回收），严格按 §3.2 顺序（rebase→collect→audit commit→ff）串联。TASK-021 幂等恢复用 branchMerged（已进入 main 跳过合并）+ abortOrCleanRebase（丢弃不完整 rebase）。TASK-026 task:run 经 WorktreePort create/reset/retain/remove 管理 worktree 生命周期。ISS-007：commitAuditResult 依赖 git user.name/email 已配置（本适配器不设 config，AGENTS §4 不隐藏兼容），CLI init（TASK-023）须确保仓库配置。ISS-008：reset 基线为内存 Map，跨 CLI 进程续跑（restart_on_retry）时 bases 丢失会抛错，需 application 层重新 create 或持久化基线。fastForwardMain 假定 mainRef 短分支名——若未来需支持完整 ref 或 commit，改 update-ref 的 ref 构造逻辑。Windows 路径：worktreePath 用 resolve 保证绝对，git worktree add 接受 Windows 绝对路径（测试在 Git Bash + git 2.53 验证）。若 Orchestrator 认为：(a) reset 应支持跨进程恢复基线——改持久化到 worktree git config（见 ISS-008 方案 A）；(b) fastForwardMain 应切换工作区 checkout main——改用 merge --ff-only（但副作用）；(c) collectPostRebaseCommits 应用 %B 全 message——改 fmt + 解析（多行 message）。新增 Port 方法时两适配器须同步补全（结构兼容）。"
  issues:
    - id: ""
      title: "commitAuditResult 依赖 git user.name / user.email 已配置，本适配器不设 config（AGENTS §4 不隐藏兼容）"
      status: open
      severity: low
      scope: infrastructure/git/worktree-adapter
      created_from_task: TASK-018
      owner: ""
      recommended_action: "commitAuditResult 内部执行 `git commit`，若仓库未配置 user.name / user.email，git 报错「Please tell me who you are」导致抛 GitAdapterError。本适配器不主动 `git config` 设置身份（AGENTS §4「运行时容错必须作为显式错误处理或能力声明，不作为隐藏兼容逻辑存在」）——commit 身份是仓库 / 全局环境配置，非适配器职责。当前测试夹具用 local config（`git config user.email/name`）保证可 commit。建议（待 Orchestrator 确认）：(A) CLI init（TASK-023）在 `agent init` 时检测并提示 / 写入仓库 user.name + user.email（推荐，init 是显式配置时机）；(B) 在 commitAuditResult 前用 `git config user.name` 检测缺失并抛带指引的领域错误（显式失败优于隐藏默认）；(C) 接受现状，文档约定使用方须确保 git 身份配置。不阻塞 TASK-018 验收（适配器语义正确，commit 身份是环境前置），但 TASK-023 / TASK-026 落地 CLI 时须处理，否则 task:run 回填 audit commit 会失败。"
    - id: ""
      title: "reset 基线为内存 Map，跨 CLI 进程续跑（restart_on_retry）时丢失，reset 会抛错"
      status: open
      severity: medium
      scope: infrastructure/git/worktree-adapter
      created_from_task: TASK-018
      owner: ""
      recommended_action: "WorktreeAdapter.reset 依赖 create 时记入 bases Map 的基线 commit hash。§7 续跑语义（rejected→ready / blocked→ready）保留已存在的 worktree，若 frontmatter 声明 restart_on_retry: true 则 reset 重跑。但每次 CLI 调用（task:run）是新进程、新适配器实例，bases Map 不跨进程持久——跨 CLI 续跑触发 reset 时 bases 无记录，抛「未由本适配器 create，无法确定重置基线」。当前实现单进程内 create→reset 有效（测试覆盖），但 §3.2 续跑通常跨 CLI 调用。建议（任选其一，待 Orchestrator 裁定）：(A) create 时把基线 hash 写入 worktree 的 git config（如 `git config workflow.base <hash>`，存于主仓库 .git/worktrees/<id>/config），reset 时读回——跨进程持久、与 worktree 生命周期绑定（推荐，工作区删除即随 config 消失）；(B) reset 从 git 推断基线（worktree 分支首个 commit 的 parent，或与 main 的 merge-base），但 main 可能已变、worktree 可能无 commit，推断不可靠；(C) application 层（TASK-026）在跨进程续跑发现 worktree 已存在时，先 remove 旧 worktree 再 create 新 worktree（绕过 reset，但丢失「保留 worktree」语义）。不阻塞 TASK-018 验收（适配器在单进程 create→reset 链路正确，跨进程是组合层问题），但 TASK-026 task:run 落地续跑前须选定方案，否则 restart_on_retry 在跨 CLI 场景失效。关联 DEC-015（create 记录基线设计）。"
next_action: review
---

# TASK-018 执行结果

## 1. 执行结论

已完成。实现 `WorktreeAdapter`（create / reset / retain / remove）+ `GitMergeAdapter`（rebaseOnto / fastForwardMain / collectPostRebaseCommits / commitAuditResult / branchMerged / abortOrCleanRebase / listConflicts），通过子进程调系统 git（spawnSync），子进程错误统一转 `GitAdapterError`（含命令 / 退出码 / stderr）。19 项集成单测覆盖 §3.2 / §7 全部原语路径（含 rebase 冲突不抛断 + listConflicts、fast-forward 无 merge commit、分叉抛错、collect 采集元信息 + 时序、abort 幂等清理、reset 保留 node_modules）。typecheck 0 错误、lint 无报错、全量 489 项回归全绿。结构兼容 application 层 `WorktreePort` / `GitMergePort`，为 TASK-019 / 021 / 026 提供 git 底层原语。

## 2. 完成内容

- `WorktreeAdapter.create(mainRef, taskId)`：`rev-parse` 解析基线 commit → `worktree add -b task/<id> <path> <base>` → 记入 bases → 返回绝对路径。
- `WorktreeAdapter.reset(taskId)`：回到 bases 记录的基线（`reset --hard` + `clean -fd`，保留被忽略文件）。
- `WorktreeAdapter.retain(taskId)`：显式保留 no-op。
- `WorktreeAdapter.remove(taskId)`：existsSync + rev-parse --verify 守卫，幂等删 worktree + 分支。
- `GitMergeAdapter.rebaseOnto(taskId, mainRef)`：冲突不抛断（isRebaseInProgress 区分停顿 vs 真错误）。
- `GitMergeAdapter.fastForwardMain(taskId, mainRef)`：is-ancestor 验证 + update-ref 移动 ref（无 merge commit）。
- `GitMergeAdapter.collectPostRebaseCommits(taskId, baseRef)`：\x1f/\x1e 分隔、--reverse 时间正序、去首尾换行。
- `GitMergeAdapter.commitAuditResult(taskId, resultPath)`：提交独立 workflow audit commit。
- `GitMergeAdapter.branchMerged(taskId, mainRef)`：is-ancestor 判定。
- `GitMergeAdapter.abortOrCleanRebase(taskId)`：幂等清理（无 rebase 静默）。
- `GitMergeAdapter.listConflicts(taskId)`：diff --diff-filter=U 列 unmerged 文件。
- `GitAdapterError`：封装 command / exitCode / stderr（§12 领域错误）。

## 3. 修改文件

- src/infrastructure/index.ts — 追加 `export * from './git/worktree-adapter.js'`

## 4. 新增文件

- src/infrastructure/git/worktree-adapter.ts
- test/infrastructure/git/worktree-adapter.test.ts

## 5. 删除文件

暂无。

## 6. 架构决策

- DEC-015（proposed）：Git 适配器设计——子进程调 git + GitAdapterError 领域错误、create 记录基线 commit、reset clean -fd 保留 node_modules、fastForwardMain 用 update-ref 避免 merge commit、rebase 冲突不抛断、collect 用 \x1f/\x1e 分隔去换行、abort 幂等、两适配器构造同形。

## 7. 偏离计划

无源码偏离。两处环境 / 组合层限制（commit 身份配置、reset 基线跨进程持久化）如实记 ISS-007 / ISS-008 提议，未自行越界设 git config 或改 Port 契约。

## 8. 后续任务注意事项

- TASK-019 rebase-ff 合并：按 §3.2 顺序串联 rebaseOnto → collectPostRebaseCommits → commitAuditResult → fastForwardMain；冲突走 listConflicts → 转 blocked。
- TASK-021 幂等恢复：用 branchMerged 判已合并跳过、abortOrCleanRebase 清不完整 rebase。
- TASK-026 task:run：经 WorktreePort create（ready→running）/ reset（restart_on_retry）/ remove（终态回收）；落地前须先解 ISS-008（跨进程 reset 基线）。
- TASK-023 init：须确保仓库 git user.name/email 配置（ISS-007），否则 commitAuditResult 失败。
- application 层经 `WorktreePort` / `GitMergePort` 调用，不直接 import 本实现类（ARCHITECTURE §4）。

## 9. 未解决问题

- ISS-007（low，open）：commitAuditResult 依赖 git user.name/email 已配置，本适配器不设 config（AGENTS §4）；建议 CLI init 检测 / 写入。
- ISS-008（medium，open）：reset 基线为内存 Map，跨 CLI 进程续跑时丢失，reset 抛错；建议 create 写 worktree git config 持久化基线。
- ISS-004 / ISS-005 / ISS-006 延续，本任务未触发（本任务不引用 VerificationResultSchema；全量回归在 Node 22 下通过；本任务不涉及级联）。

## 10. 验证结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | passed | 0 错误（strict + noUncheckedIndexedAccess） |
| `npm test -- infrastructure/git/worktree-adapter` | passed | 19 项集成单测全绿（临时 git 仓库） |
| `npm run lint` | passed | eslint 无报错 |
| `npm test`（全量） | passed | 489 项全绿（Node 22 ABI 127，含 SQLite） |
