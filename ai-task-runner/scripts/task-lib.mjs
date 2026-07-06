import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, appendFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

/*
 * 这里集中定义 Runner 的状态机。
 * draft/reviewed 只能作为人工或审查阶段的中间态，ready 才能被执行，
 * 这样可以避免未经审查的 SPEC、PLAN、task 直接进入开发阶段。
 */
export const TASK_STATUS = Object.freeze({
  draft: 'draft',
  reviewed: 'reviewed',
  ready: 'ready',
  running: 'running',
  done: 'done',
  failed: 'failed',
  blocked: 'blocked'
});

const RUNNABLE_STATUS = TASK_STATUS.ready;
/*
 * Runner 自身目录和目标项目目录必须分离。
 * 这样工具可以作为独立包跨项目复用，目标项目只需要保存 SPEC/PLAN/tasks，
 * 不需要复制 Runner 的执行 prompt 或脚本实现。
 */
const RUNNER_ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const RUNNER_IGNORED_CHANGED_PATHS = ['.ai-task-runner.lock', 'docs/ai-runner-logs'];
const REQUIRED_TASK_FIELDS = ['id', 'status', 'branch', 'spec', 'plan', 'commit', 'depends_on', 'agent_allowed_paths', 'verify'];
const DEFAULT_CLAUDE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_VERIFY_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_CONFIG_PATH = '.ai-runner/config.yml';
/*
 * headless 模式下给 Claude 一个回合上限，防止它在死循环里烧算力；
 * 超时是时间维度兜底，max-turns 是 Claude 原生回合维度兜底，两者互补。
 * 超时则用 AI_RUNNER_CLAUDE_MAX_TURNS 覆盖。
 */
const DEFAULT_CLAUDE_MAX_TURNS = 50;
/*
 * Claude 进程超时或非零退出属于瞬态失败，给一次重试机会避免整条 ai:all 链路被一次网络抖动打断。
 * 路径越界/blocked/verify 失败是确定性失败，不重试。
 * 覆盖用 AI_RUNNER_CLAUDE_MAX_RETRIES。
 */
const DEFAULT_CLAUDE_MAX_RETRIES = 1;
/*
 * verify 失败后给 Claude 一次带失败日志的修复机会。
 * 这让 Runner 不只是“事后判失败”，而是形成实现 -> 验证 -> 修复的闭环；
 * 仍然限制次数，避免测试长期失败时进入不可控循环。
 */
const DEFAULT_VERIFY_REPAIR_ATTEMPTS = 1;
/*
 * 提交前用一个全新 Claude 上下文做只读实现审查。
 * 它不会修改代码，只根据 task、diff 和相关文件判断是否存在必须阻断的问题，
 * 用来弥补单个实现 agent 可能遗漏边界或架构风险的问题。
 */
const DEFAULT_REVIEW_MAX_TURNS = 12;
/*
 * headless 执行阶段不再使用 acceptEdits。
 * 所有基础工具都通过 allowedTools 显式声明，Bash 只能由 task 自己按最小命令规格追加，
 * 避免文件系统类 Bash 命令绕过 agent_allowed_paths 的工具级闸门。
 */
const DEFAULT_IMPLEMENTATION_ALLOWED_TOOLS = Object.freeze([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit'
]);
/*
 * 审查阶段是只读上下文，只允许读取和搜索文件。
 * diff 由 Runner 注入 prompt，不给审查 agent 任何编辑或通用 Bash 能力，
 * 让“审查”和“实现”在权限层面保持清晰分离。
 */
const REVIEW_ALLOWED_TOOLS = Object.freeze([
  'Read',
  'Glob',
  'Grep',
  'LS'
]);
const REVIEW_FAILED_SIGNAL = 'AI_TASK_REVIEW_FAILED:';
const REVIEW_PASSED_SIGNAL = 'AI_TASK_REVIEW_PASSED';
const TEXT_SNIPPET_LIMIT = 20000;
/*
 * stream-json 回显里单条工具调用详情（命令、路径或查询）的最大长度。
 * 太长会刷屏并淹没关键信息，截断后用省略号提示；完整内容仍保留在日志文件中。
 */
const TOOL_USE_DISPLAY_LIMIT = 120;

/*
 * 这些路径过宽或会破坏 Runner 自己的调度数据。
 * task 必须把 AI 的改动范围限制到具体模块、测试或明确文件，
 * 不能把整个 src/docs/scripts 之类的上层目录直接暴露给实现阶段。
 */
const FORBIDDEN_AGENT_PATHS = new Set([
  '',
  '.',
  '..',
  '/',
  '\\',
  'src',
  'app',
  'pages',
  'components',
  'lib',
  'docs',
  'scripts',
  'prompt',
  '.git'
]);

/*
 * 这些是跨项目通用的受保护文件模式。
 * 它们表达的是 Runner 的分层边界：实现阶段可以改业务代码和测试，
 * 但不能反向修改已经确认的规格、计划、任务状态或 git 元数据。
 */
const DEFAULT_FORBIDDEN_AGENT_PATH_PATTERNS = [
  'docs/tasks/**',
  'docs/SPEC_*',
  'docs/PLAN_*',
  '.git/**',
  '.ai-runner/**',
  '.ai-task-runner.lock',
  /*
   * Runner 脚本属于调度层，不能被单个业务 task 反向修改。
   * 这里把入口脚本、共享库和执行 prompt 一起保护起来，
   * 避免 task 通过 agent_allowed_paths 绕开 README 和 prompt 中声明的边界。
   */
  'scripts/task-lib.mjs',
  'scripts/ai-run-*.mjs',
  'scripts/ai-reset-task.mjs',
  'scripts/ai-validate-tasks.mjs',
  'scripts/ai-task-*',
  'scripts/ai-task-status.mjs',
  'scripts/ai-task-prompt.md'
];

/*
 * verify 只应该做可结束的检查。
 * 这里拦截会改变 git 历史、删除文件或启动长期服务的命令，
 * 避免验证阶段把工作区推进到 Runner 无法推导的状态。
 */
const DISALLOWED_VERIFY_COMMANDS = [
  { pattern: /\bgit\s+(add|commit|push|reset|checkout|switch|merge|rebase)\b/i, reason: 'verify 不能执行 git 变更命令' },
  { pattern: /\bgit\s+(clean|restore|rm|stash)\b/i, reason: 'verify 不能执行 git 工作区破坏命令' },
  { pattern: /\brm\s+-rf\b/i, reason: 'verify 不能执行递归删除' },
  { pattern: /\brm\s+-fr\b/i, reason: 'verify 不能执行递归删除' },
  { pattern: /\brimraf\b/i, reason: 'verify 不能执行递归删除' },
  { pattern: /\bRemove-Item\b[\s\S]*\b-Recurse\b/i, reason: 'verify 不能执行递归删除' },
  { pattern: /\bdel\s+\/s\b/i, reason: 'verify 不能执行递归删除' },
  { pattern: /\brd\s+\/s\b/i, reason: 'verify 不能执行递归删除' },
  { pattern: /\brmdir\s+\/s\b/i, reason: 'verify 不能执行递归删除' },
  { pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve)\b/i, reason: 'verify 不能启动长期运行的开发服务' },
  { pattern: /\b(?:vite|next|nuxt|astro)\s+(?:dev|start|serve)\b/i, reason: 'verify 不能启动长期运行的开发服务' }
];

/*
 * 仅这一类失败被视为“可重试”：Claude 进程本身超时或非零退出。
 * 路径越界、blocked、verify 失败都是确定性失败，重试无意义，沿用普通 Error。
 */
class RetryableRunnerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RetryableRunnerError';
  }
}

/*
 * verify 失败需要携带命令、退出码和输出。
 * 后续修复 prompt 直接复用这些结构化信息，避免 Claude 只能看到一句笼统错误，
 * 也避免 Runner 从日志文件里再做脆弱的字符串反查。
 */
class VerifyFailureError extends Error {
  constructor(command, result) {
    const detail = result.timedOut
      ? '执行超时'
      : `退出码：${result.exitCode}`;
    super(`验证命令失败（${detail}）：${command}`);
    this.name = 'VerifyFailureError';
    this.command = command;
    this.result = result;
  }
}

/*
 * CLI 参数在这里统一解析，保持各个入口脚本很薄。
 * 后续如果要接入 CI 或 dashboard，只需要复用这个稳定的参数契约。
 */
export function parseRunnerCliArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--project-root') {
      options.projectRoot = requireNextArg(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--runner-root') {
      options.runnerRoot = requireNextArg(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--config') {
      options.configPath = requireNextArg(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--task') {
      options.taskId = requireNextArg(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--status') {
      options.status = requireNextArg(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--validate') {
      options.validate = true;
      continue;
    }

    if (arg === '--allow-empty') {
      options.allowEmpty = true;
      continue;
    }

    if (arg === '--reset-branch') {
      options.resetBranch = true;
      continue;
    }

    throw new Error(`未知参数：${arg}`);
  }

  return options;
}

export function createRunnerContext(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const runnerRoot = path.resolve(options.runnerRoot || RUNNER_ROOT);
  const config = readRunnerConfig(projectRoot, options.configPath);
  const promptTemplatePath = resolveConfigPath(
    projectRoot,
    runnerRoot,
    config.prompt_template_path,
    path.join(runnerRoot, 'scripts', 'ai-task-prompt.md')
  );

  return {
    projectRoot,
    runnerRoot,
    configPath: resolveOptionalConfigPath(projectRoot, options.configPath),
    taskDir: resolveConfigPath(projectRoot, runnerRoot, config.task_dir, path.join(projectRoot, 'docs', 'tasks')),
    promptTemplatePath,
    logDir: resolveConfigPath(projectRoot, runnerRoot, config.log_dir, path.join(projectRoot, 'docs', 'ai-runner-logs')),
    lockFile: resolveConfigPath(projectRoot, runnerRoot, config.lock_file, path.join(projectRoot, '.ai-task-runner.lock')),
    taskId: options.taskId ? String(options.taskId) : '',
    dryRun: Boolean(options.dryRun),
    allowEmpty: Boolean(options.allowEmpty),
    branchPolicy: normalizeBranchPolicy(config.branch_policy),
    forbiddenAgentPathPatterns: normalizeForbiddenAgentPathPatterns(config.forbidden_agent_paths),
    verifyPolicy: normalizeVerifyPolicy(config.verify_policy),
    claudeTimeoutMs: readTimeoutMs('AI_RUNNER_CLAUDE_TIMEOUT_MS', DEFAULT_CLAUDE_TIMEOUT_MS),
    verifyTimeoutMs: readTimeoutMs('AI_RUNNER_VERIFY_TIMEOUT_MS', DEFAULT_VERIFY_TIMEOUT_MS),
    claudeMaxTurns: readPositiveInt('AI_RUNNER_CLAUDE_MAX_TURNS', DEFAULT_CLAUDE_MAX_TURNS),
    claudeMaxRetries: readNonNegativeInt('AI_RUNNER_CLAUDE_MAX_RETRIES', DEFAULT_CLAUDE_MAX_RETRIES),
    verifyRepairAttempts: readNonNegativeInt('AI_RUNNER_VERIFY_REPAIR_ATTEMPTS', DEFAULT_VERIFY_REPAIR_ATTEMPTS),
    reviewMaxTurns: readPositiveInt('AI_RUNNER_REVIEW_MAX_TURNS', DEFAULT_REVIEW_MAX_TURNS),
    gitPathPrefix: undefined
  };
}

/*
 * 项目配置是跨项目通用性的扩展点。
 * 没有配置文件时使用 Runner 内置默认值；显式传入 --config 时文件必须存在，
 * 避免用户以为某套项目策略已经生效，实际却被静默忽略。
 */
function readRunnerConfig(projectRoot, configPath) {
  const resolvedConfigPath = resolveOptionalConfigPath(projectRoot, configPath);

  if (!existsSync(resolvedConfigPath)) {
    if (configPath) {
      throw new Error(`指定的 Runner 配置文件不存在：${toPosix(resolvedConfigPath)}`);
    }

    return {};
  }

  const document = YAML.parseDocument(readFileSync(resolvedConfigPath, 'utf8'), {
    prettyErrors: true,
    strict: true
  });

  if (document.errors.length > 0) {
    throw new Error(`Runner 配置文件不是合法 YAML：${document.errors[0].message}`);
  }

  const config = document.toJS() || {};

  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new Error('Runner 配置文件必须是 YAML 对象。');
  }

  return config;
}

/*
 * 配置里的路径默认相对目标项目解析。
 * 只有 Runner 自带的默认 prompt 会落在 runnerRoot 下，这样既能跨项目复用，
 * 又不会允许配置把关键路径指向项目和工具目录之外。
 */
function resolveConfigPath(projectRoot, runnerRoot, rawValue, defaultPath) {
  const targetPath = rawValue
    ? path.resolve(projectRoot, String(rawValue))
    : path.resolve(defaultPath);

  if (!isInsideRoot(projectRoot, targetPath) && !isInsideRoot(runnerRoot, targetPath)) {
    throw new Error(`Runner 配置路径必须位于项目或 Runner 目录内：${rawValue || defaultPath}`);
  }

  return targetPath;
}

function resolveOptionalConfigPath(projectRoot, configPath = '') {
  const rawPath = configPath || DEFAULT_CONFIG_PATH;
  const targetPath = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(projectRoot, rawPath);

  if (!isInsideRoot(projectRoot, targetPath)) {
    throw new Error(`Runner 配置文件必须位于项目内：${rawPath}`);
  }

  return targetPath;
}

/*
 * 项目可以追加更多受保护路径模式。
 * 默认模式只保护 SPEC/PLAN/task/Runner 元数据，业务项目仍然可以按 task 需要
 * 精确允许普通文档、测试夹具或其它非代码资产。
 */
function normalizeForbiddenAgentPathPatterns(value) {
  return [
    ...DEFAULT_FORBIDDEN_AGENT_PATH_PATTERNS,
    ...normalizeArray(value)
  ].map(normalizeAllowedPath);
}

/*
 * verify 策略支持项目级 allowlist 和 denylist。
 * denylist 用正则表达式表达高风险命令；allowlist 用前缀表达可接受命令族，
 * 让不同技术栈可以复用 Runner，而不是把 pnpm/npm/vitest 等细节写死在核心里。
 */
function normalizeVerifyPolicy(value) {
  const policy = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const allowPrefixes = normalizeArray(policy.allow_prefixes).map((item) => String(item).trim()).filter(Boolean);
  const denyPatterns = normalizeArray(policy.deny_patterns)
    .map((pattern) => {
      try {
        return new RegExp(pattern, 'i');
      } catch (error) {
        throw new Error(`verify_policy.deny_patterns 包含非法正则：${pattern}`);
      }
    });

  return {
    allowPrefixes,
    denyPatterns
  };
}

/*
 * 分支策略必须显式表达，避免批量执行时分支来源依赖“当前所在分支”这种隐式状态。
 * 默认 chained 保持现有串行累积行为；base 模式适合彼此独立的 task 分支。
 */
function normalizeBranchPolicy(value) {
  const policy = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const mode = String(policy.mode || 'chained').trim();
  const baseBranch = String(policy.base_branch || '').trim();

  if (!['chained', 'base'].includes(mode)) {
    throw new Error(`branch_policy.mode 只能是 chained 或 base：${mode}`);
  }

  if (mode === 'base' && !baseBranch) {
    throw new Error('branch_policy.mode 为 base 时必须声明 branch_policy.base_branch。');
  }

  return {
    mode,
    baseBranch
  };
}

export function loadTasks(options = {}) {
  const context = resolveContext(options);

  if (!existsSync(context.taskDir)) {
    return [];
  }

  return readdirSync(context.taskDir)
    .filter((fileName) => fileName.endsWith('.md'))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => readTask(context, path.join(context.taskDir, fileName)));
}

export function printTaskStatus(tasks) {
  if (tasks.length === 0) {
    console.log('没有找到 docs/tasks/*.md 任务文件。');
    return;
  }

  const rows = tasks.map((task) => ({
    id: String(task.meta.id || task.fileName),
    status: String(task.meta.status || 'unknown'),
    branch: String(task.meta.branch || 'missing-branch'),
    title: task.title
  }));

  const idWidth = Math.max(...rows.map((row) => row.id.length), 2);
  const statusWidth = Math.max(...rows.map((row) => row.status.length), 6);
  const branchWidth = Math.max(...rows.map((row) => row.branch.length), 6);

  console.log(`${'ID'.padEnd(idWidth)}  ${'STATUS'.padEnd(statusWidth)}  ${'BRANCH'.padEnd(branchWidth)}  TITLE`);

  for (const row of rows) {
    console.log(`${row.id.padEnd(idWidth)}  ${row.status.padEnd(statusWidth)}  ${row.branch.padEnd(branchWidth)}  ${row.title}`);
  }
}

export function validateTaskQueue(options = {}) {
  const context = resolveContext(options);
  const tasks = loadTasks(context);

  validateTaskSet(context, tasks, { allowEmpty: context.allowEmpty });
  console.log(`任务队列校验通过：${tasks.length} 个任务。`);

  return tasks;
}

export async function runNextTask(options = {}) {
  const context = resolveContext(options);

  return withRunnerLock(context, async () => {
    ensureGitRepository(context);

    const tasks = loadTasks(context);
    validateTaskSet(context, tasks, { allowEmpty: true });
    const task = selectRunnableTask(context, tasks);

    if (!task) {
      console.log('没有 ready 状态且依赖已完成的任务。');
      return false;
    }

    await runTask(context, task, tasks);
    return true;
  });
}

export async function resetTaskStatus(options = {}) {
  const context = resolveContext(options);

  if (!context.taskId) {
    throw new Error('恢复任务状态必须传入 --task TASK_ID。');
  }

  const nextStatus = String(options.status || TASK_STATUS.ready);

  if (!Object.values(TASK_STATUS).includes(nextStatus)) {
    throw new Error(`未知任务状态：${nextStatus}`);
  }

  /*
   * reset 会改写 task 状态文件，必要时还会切分支并丢弃工作区改动，
   * 必须和 Runner 互斥，避免和正在执行的任务竞争同一个工作区。
   */
  return withRunnerLock(context, async () => {
    ensureGitRepository(context);

    const tasks = loadTasks(context);
    validateTaskSet(context, tasks, { allowRunning: true });
    const task = findTaskById(tasks, context.taskId);

    if (!task) {
      throw new Error(`没有找到任务：${context.taskId}`);
    }

    /*
     * 失败或中断后，task 分支上可能残留 Claude 的未提交改动，
     * 直接重跑会被 ensureCleanWorkingTree 拦下。
     * --reset-branch 会切到该 task 分支并丢弃这些改动，
     * 再把恢复后的状态落盘提交，让任务回到可直接重跑的干净状态。
     */
    if (options.resetBranch) {
      discardTaskBranchChanges(context, task);
    }

    markTaskStatus(context, task, nextStatus);

    if (options.resetBranch) {
      commitTaskStatusReset(context, task, nextStatus);
    }

    console.log(`任务状态已恢复：${task.meta.id} -> ${nextStatus}`);
  });
}

function discardTaskBranchChanges(context, task) {
  const branch = String(task.meta.branch || '').trim();

  if (!branch) {
    throw new Error(`${task.relativePath} 没有声明 branch，无法 --reset-branch。`);
  }

  const existingBranches = runGit(context, ['branch', '--list', branch], { capture: true }).trim();

  if (!existingBranches) {
    console.log(`task 分支不存在，跳过工作区清理：${branch}`);
    return;
  }

  runGit(context, ['switch', branch]);
  discardWorkingTreeChanges(context);
  console.log(`已丢弃 task 分支上的未提交改动：${branch}`);
}

/*
 * 把工作区恢复到 HEAD：tracked 文件还原，未跟踪文件删除。
 * 不加 -x，node_modules、日志、锁文件、enforcement 产物等被忽略的内容不会被误删。
 * --reset-branch 和瞬态失败重试都复用这套清理，保证每次尝试都从干净状态开始。
 */
function discardWorkingTreeChanges(context) {
  runGit(context, ['restore', '--staged', '--worktree', '--', '.']);
  runGit(context, ['clean', '-fd']);
}

function commitTaskStatusReset(context, task, nextStatus) {
  /*
   * markTaskStatus 会把状态写入 task 文件，使工作区再次变脏。
   * 这里只提交该 task 状态文件，保证 reset 结束后工作区干净、可直接重跑，
   * 不会把恢复过程中残留的其它改动一起带入提交。
   */
  runGit(context, ['add', '--', task.relativePath]);
  runGit(context, ['commit', '-m', `chore(${task.meta.id}): 重置任务状态为 ${nextStatus}`]);
  console.log(`已提交任务状态重置：${task.meta.id} -> ${nextStatus}`);
}

async function runTask(context, task, tasks) {
  ensureTaskIsRunnable(task);
  ensureDependenciesDone(task, tasks);

  if (context.dryRun) {
    printDryRunTask(task);
    return;
  }

  ensureCleanWorkingTree(context);
  ensureGitCommitIdentity(context);
  ensureClaudeAvailable(context);

  const logPath = createTaskLog(context, task);
  appendLog(logPath, `准备执行 ${task.meta.id}：${task.title}`);

  ensureBranch(context, String(task.meta.branch));

  /*
   * 瞬态失败（Claude 超时或非零退出）最多重试 claudeMaxRetries 次。
   * 每次重试前先丢弃上一轮残留改动，保证从干净工作区重新开始；
   * 每次尝试都重新把状态置为 running 并重新快照，让 task 文件保护检查保持有效。
   */
  const maxAttempts = Math.max(1, context.claudeMaxRetries + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    markTaskStatus(context, readTask(context, task.filePath), TASK_STATUS.running);
    const runningTask = readTask(context, task.filePath);
    const runnerOwnedSnapshots = snapshotRunnerOwnedFiles(context, runningTask);

    try {
      const claudeResult = await runClaudeTask(context, runningTask, logPath);
      assertClaudeExecutionSucceeded(context, runningTask, runnerOwnedSnapshots, claudeResult);

      ensureRunnerOwnedFilesUnchanged(context, runnerOwnedSnapshots);
      ensureTaskChangedSomething(context, runningTask, runnerOwnedSnapshots);
      validateAgentChangedPaths(context, runningTask, runnerOwnedSnapshots);
      await runVerifyWithRepairs(context, runningTask, logPath, runnerOwnedSnapshots);
      validateAgentChangedPaths(context, runningTask, runnerOwnedSnapshots);
      await runImplementationReview(context, runningTask, logPath, runnerOwnedSnapshots);
      validateAgentChangedPaths(context, runningTask, runnerOwnedSnapshots);

      markTaskStatus(context, runningTask, TASK_STATUS.done);
      commitTask(context, readTask(context, task.filePath));

      appendLog(logPath, `任务完成并已提交：${task.meta.id}`);
      console.log(`任务完成并已提交：${task.meta.id}`);
      return;
    } catch (error) {
      const canRetry = error instanceof RetryableRunnerError && attempt < maxAttempts;

      if (canRetry) {
        appendLog(logPath, `第 ${attempt} 次尝试失败（${error.message}），重置工作区后重试。`);
        /*
         * 瞬态失败重试发生在 Claude 进程已经退出之后，终端上只会看到上一轮静默结束。
         * 这里显式回显失败原因和重试动作，避免"重试"这一关键事件只留在日志里、终端看起来像卡住。
         */
        console.log(`第 ${attempt} 次尝试失败：${error.message}，重置工作区后重试。`);
        discardWorkingTreeChanges(context);
        continue;
      }

      if (readTask(context, task.filePath).meta.status !== TASK_STATUS.blocked) {
        markTaskStatus(context, readTask(context, task.filePath), TASK_STATUS.failed, error.message);
      }

      appendLog(logPath, `任务失败：${error.message}`);
      throw error;
    }
  }
}

function validateTaskSet(context, tasks, options = {}) {
  if (tasks.length === 0 && !options.allowEmpty) {
    throw new Error('没有找到 docs/tasks/*.md 任务文件，无法校验可执行任务队列。');
  }

  const seenIds = new Set();

  for (const task of tasks) {
    validateTaskSchema(context, task, options);

    if (seenIds.has(String(task.meta.id))) {
      throw new Error(`任务 id 重复：${task.meta.id}`);
    }

    seenIds.add(String(task.meta.id));
  }

  for (const task of tasks) {
    validateTaskDependencies(task, tasks);
  }

  validateTaskDependencyGraph(tasks);
}

function validateTaskSchema(context, task, options = {}) {
  for (const field of REQUIRED_TASK_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(task.meta, field)) {
      throw new Error(`${task.relativePath} 缺少必填字段：${field}`);
    }
  }

  const status = String(task.meta.status);

  if (!Object.values(TASK_STATUS).includes(status)) {
    throw new Error(`${task.relativePath} 使用了未知状态：${status}`);
  }

  if (status === TASK_STATUS.running && !options.allowRunning) {
    throw new Error(`${task.relativePath} 停留在 running 状态，请先恢复或人工处理。`);
  }

  ensureRelativeFileExists(context, task, 'spec');
  ensureRelativeFileExists(context, task, 'plan');
  validateStringField(task, 'id');
  validateStringField(task, 'branch');
  validateStringField(task, 'commit');
  validateTaskTitle(task);
  validateAgentAllowedPaths(context, task);
  validateVerifyCommands(context, task);
  validateAllowedTools(task);
  validateBranchPolicyConstraints(context, task);
}

function validateBranchPolicyConstraints(context, task) {
  /*
   * base 模式下每个 task 分支都从 base_branch 独立拉出，
   * 依赖任务的 done 提交留在各自分支上，不会出现在新分支工作区里。
   * 此时 depends_on 没有实际意义，反而让依赖检查依赖切分支前的陈旧快照，
   * 因此 base 模式强制 depends_on 为空，保证任务彼此独立、可各自验证。
   */
  if (context.branchPolicy.mode !== 'base') {
    return;
  }

  const dependencies = normalizeArray(task.meta.depends_on);

  if (dependencies.length > 0) {
    throw new Error(`${task.relativePath} 在 branch_policy.mode=base 下不能声明 depends_on，base 模式仅用于彼此独立的任务：${dependencies.join(', ')}`);
  }
}

function validateTaskDependencies(task, tasks) {
  const dependencies = normalizeArray(task.meta.depends_on);

  for (const dependencyId of dependencies) {
    if (!findTaskById(tasks, dependencyId)) {
      throw new Error(`${task.relativePath} 依赖了不存在的任务：${dependencyId}`);
    }
  }
}

/*
 * Runner 只能执行有向无环任务图。
 * 如果 PLAN 里出现循环依赖，所有相关 task 都永远无法进入 done，
 * 因此必须在执行前审查阶段直接报出完整依赖链。
 */
function validateTaskDependencyGraph(tasks) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  for (const task of tasks) {
    visitTaskDependencyNode(task, tasks, visiting, visited, stack);
  }
}

function visitTaskDependencyNode(task, tasks, visiting, visited, stack) {
  const taskId = String(task.meta.id);

  if (visited.has(taskId)) {
    return;
  }

  if (visiting.has(taskId)) {
    const cycleStartIndex = stack.indexOf(taskId);
    const cycle = [...stack.slice(cycleStartIndex), taskId].join(' -> ');
    throw new Error(`任务依赖存在循环：${cycle}`);
  }

  visiting.add(taskId);
  stack.push(taskId);

  for (const dependencyId of normalizeArray(task.meta.depends_on)) {
    visitTaskDependencyNode(findTaskById(tasks, dependencyId), tasks, visiting, visited, stack);
  }

  stack.pop();
  visiting.delete(taskId);
  visited.add(taskId);
}

function validateStringField(task, field) {
  if (!String(task.meta[field] || '').trim()) {
    throw new Error(`${task.relativePath} 字段不能为空：${field}`);
  }
}

function validateTaskTitle(task) {
  /*
   * task 标题会进入 dry-run、日志和默认认知上下文。
   * 强制写一级标题可以避免“未命名任务”进入执行阶段，
   * 也让 AI 在读取 task 时先看到明确任务边界。
   */
  if (task.title === '未命名任务') {
    throw new Error(`${task.relativePath} 必须包含一级标题，例如：# TASK_001 任务名`);
  }
}

function ensureRelativeFileExists(context, task, field) {
  const filePath = resolveProjectPath(context, String(task.meta[field] || ''));

  if (!existsSync(filePath)) {
    throw new Error(`${task.relativePath} 声明的 ${field} 文件不存在：${task.meta[field]}`);
  }
}

function validateAgentAllowedPaths(context, task) {
  const allowedPaths = normalizeArray(task.meta.agent_allowed_paths);
  const protectedFiles = [
    task.relativePath,
    task.meta.spec,
    task.meta.plan
  ].map(normalizeAllowedPath);

  if (allowedPaths.length === 0) {
    throw new Error(`${task.relativePath} 缺少 agent_allowed_paths。每个 task 必须限制 AI 可改范围。`);
  }

  for (const rawPath of allowedPaths) {
    const normalizedPath = normalizeAllowedPath(rawPath);

    if (!normalizedPath || FORBIDDEN_AGENT_PATHS.has(normalizedPath)) {
      throw new Error(`${task.relativePath} 的 agent_allowed_paths 过宽：${rawPath}`);
    }

    if (path.isAbsolute(rawPath) || normalizedPath.includes('..') || normalizedPath.includes('*')) {
      throw new Error(`${task.relativePath} 的 agent_allowed_paths 必须是项目内相对路径：${rawPath}`);
    }

    if (isProtectedRunnerFile(normalizedPath, protectedFiles)) {
      throw new Error(`${task.relativePath} 不能允许 AI 修改 SPEC/PLAN/task 状态文件：${rawPath}`);
    }

    if (matchesAnyPathPattern(normalizedPath, context.forbiddenAgentPathPatterns)) {
      throw new Error(`${task.relativePath} 的 agent_allowed_paths 命中受保护路径：${rawPath}`);
    }
  }
}

function validateVerifyCommands(context, task) {
  const verifyCommands = normalizeArray(task.meta.verify);

  if (verifyCommands.length === 0) {
    throw new Error(`${task.relativePath} 缺少 verify 命令。每个 task 必须可验证。`);
  }

  for (const command of verifyCommands) {
    const normalizedCommand = String(command).trim();

    if (!normalizedCommand) {
      throw new Error(`${task.relativePath} 存在空 verify 命令。`);
    }

    for (const rule of DISALLOWED_VERIFY_COMMANDS) {
      if (rule.pattern.test(normalizedCommand)) {
        throw new Error(`${task.relativePath} 的 verify 不合理：${rule.reason}：${normalizedCommand}`);
      }
    }

    for (const pattern of context.verifyPolicy.denyPatterns) {
      if (pattern.test(normalizedCommand)) {
        throw new Error(`${task.relativePath} 的 verify 命中项目 denylist：${normalizedCommand}`);
      }
    }

    if (context.verifyPolicy.allowPrefixes.length > 0 && !hasAllowedCommandPrefix(normalizedCommand, context.verifyPolicy.allowPrefixes)) {
      throw new Error(`${task.relativePath} 的 verify 不在项目 allowlist 中：${normalizedCommand}`);
    }
  }
}

function validateAllowedTools(task) {
  /*
   * allowed_tools 是可选字段：声明 task 实现阶段需要 Claude 自行执行的额外工具，
   * 例如 Bash(pnpm test:*) 用于自测。它替代了原先危险的 bypassPermissions 全开模式，
   * 让放行范围保持在最小且必要的工具规格内。
   */
  if (!Object.prototype.hasOwnProperty.call(task.meta, 'allowed_tools')) {
    return;
  }

  const rawTools = task.meta.allowed_tools;

  if (rawTools === null || rawTools === undefined) {
    return;
  }

  const tools = Array.isArray(rawTools) ? rawTools : [rawTools];

  for (const tool of tools) {
    const value = String(tool).trim();

    if (!value) {
      throw new Error(`${task.relativePath} 的 allowed_tools 不能包含空值。`);
    }

    /*
     * Bash 必须按命令族精确声明，例如 Bash(pnpm test:*)。
     * 直接放行 Bash 或 Bash(*) 会重新获得通用 shell 能力，
     * 破坏 Runner 用 default 权限模式和路径钩子建立的任务边界。
     */
    if (/^Bash(?:\((?:\s*|\s*\*\s*)\))?$/i.test(value)) {
      throw new Error(`${task.relativePath} 的 allowed_tools 不能放行通用 Bash：${value}`);
    }
  }
}

function selectRunnableTask(context, tasks) {
  const candidates = context.taskId
    ? tasks.filter((task) => String(task.meta.id) === context.taskId || task.fileName === context.taskId)
    : tasks.filter((task) => task.meta.status === RUNNABLE_STATUS);

  if (context.taskId && candidates.length === 0) {
    throw new Error(`没有找到任务：${context.taskId}`);
  }

  for (const task of candidates) {
    ensureTaskIsRunnable(task);

    if (areDependenciesDone(task, tasks)) {
      return task;
    }
  }

  const waitingTask = candidates[0];

  if (waitingTask) {
    throw new Error(`${waitingTask.meta.id} 的 depends_on 尚未全部完成。`);
  }

  return null;
}

function ensureTaskIsRunnable(task) {
  if (task.meta.status !== RUNNABLE_STATUS) {
    throw new Error(`${task.relativePath} 当前状态是 ${task.meta.status}，Runner 只执行 ready 任务。`);
  }
}

function ensureDependenciesDone(task, tasks) {
  if (!areDependenciesDone(task, tasks)) {
    throw new Error(`${task.meta.id} 的 depends_on 尚未全部完成。`);
  }
}

function areDependenciesDone(task, tasks) {
  const dependencies = normalizeArray(task.meta.depends_on);

  return dependencies.every((dependencyId) => {
    const dependencyTask = findTaskById(tasks, dependencyId);
    return dependencyTask && dependencyTask.meta.status === TASK_STATUS.done;
  });
}

function findTaskById(tasks, taskId) {
  return tasks.find((task) => String(task.meta.id) === String(taskId) || task.fileName === String(taskId));
}

function readTask(context, filePath) {
  const markdown = readFileSync(filePath, 'utf8');
  const parsed = parseFrontmatter(markdown, filePath);
  const relativePath = toPosix(path.relative(context.projectRoot, filePath));

  return {
    filePath,
    relativePath,
    fileName: path.basename(filePath),
    meta: parsed.meta,
    body: parsed.body,
    title: extractTitle(parsed.body)
  };
}

function parseFrontmatter(markdown, filePath) {
  /*
   * Windows 工具写 UTF-8 文件时可能带 BOM。
   * frontmatter 必须仍然从文档开头识别，否则合法 task 会被误判为缺少 YAML。
   */
  const normalizedMarkdown = markdown.replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(normalizedMarkdown);

  if (!match) {
    throw new Error(`${filePath} 必须包含 YAML frontmatter。`);
  }

  const document = YAML.parseDocument(match[1], {
    prettyErrors: true,
    strict: true
  });

  if (document.errors.length > 0) {
    throw new Error(`${filePath} frontmatter 不是合法 YAML：${document.errors[0].message}`);
  }

  const meta = document.toJS() || {};

  if (!meta || Array.isArray(meta) || typeof meta !== 'object') {
    throw new Error(`${filePath} frontmatter 必须是对象。`);
  }

  return {
    meta,
    body: match[2]
  };
}

function stringifyFrontmatter(meta, body) {
  const preferredOrder = [
    'id',
    'status',
    'branch',
    'spec',
    'plan',
    'commit',
    'depends_on',
    'agent_allowed_paths',
    'verify',
    'allowed_tools',
    'allow_empty_code_changes',
    'updated_at',
    'last_error'
  ];
  const orderedMeta = {};

  for (const key of preferredOrder) {
    if (Object.prototype.hasOwnProperty.call(meta, key)) {
      orderedMeta[key] = meta[key];
    }
  }

  for (const key of Object.keys(meta)) {
    if (!Object.prototype.hasOwnProperty.call(orderedMeta, key)) {
      orderedMeta[key] = meta[key];
    }
  }

  const frontmatter = YAML.stringify(orderedMeta, {
    lineWidth: 0,
    singleQuote: false
  }).trimEnd();

  return `---\n${frontmatter}\n---\n${body.replace(/^\r?\n/, '')}`;
}

function markTaskStatus(context, task, status, reason = '') {
  const nextMeta = {
    ...task.meta,
    status,
    updated_at: new Date().toISOString()
  };

  if (reason) {
    nextMeta.last_error = reason;
  } else {
    delete nextMeta.last_error;
  }

  writeFileSync(task.filePath, stringifyFrontmatter(nextMeta, task.body), 'utf8');
  console.log(`任务状态更新：${task.meta.id || task.fileName} -> ${status}`);
}

async function withRunnerLock(context, callback) {
  if (context.dryRun) {
    return callback();
  }

  const payload = [
    `pid=${process.pid}`,
    `host=${os.hostname()}`,
    `started_at=${new Date().toISOString()}`
  ].join('\n');

  acquireRunnerLock(context, payload);

  try {
    return await callback();
  } finally {
    if (existsSync(context.lockFile)) {
      unlinkSync(context.lockFile);
    }
  }
}

/*
 * 抢锁失败时不再直接报错：先判断锁持有者进程是否还活着，
 * 只有确认已退出（崩溃残留）才回收，避免 Runner 崩溃后锁文件永久死锁。
 */
function acquireRunnerLock(context, payload) {
  try {
    writeFileSync(context.lockFile, payload, {
      encoding: 'utf8',
      flag: 'wx'
    });
    return;
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }

  if (!isStaleRunnerLock(context)) {
    throw new Error(`检测到已有 Runner 在执行：${context.lockFile}`);
  }

  console.log('检测到残留锁文件且持有进程已退出，自动回收。');

  try {
    unlinkSync(context.lockFile);
  } catch {
    /* 并发竞争：其它 Runner 刚好释放，下面再次抢锁会处理 */
  }

  writeFileSync(context.lockFile, payload, {
    encoding: 'utf8',
    flag: 'wx'
  });
}

function isStaleRunnerLock(context) {
  let content;

  try {
    content = readFileSync(context.lockFile, 'utf8');
  } catch {
    return false;
  }

  const pidMatch = /^pid=(.+)$/m.exec(content);
  const hostMatch = /^host=(.+)$/m.exec(content);

  if (!pidMatch || !hostMatch) {
    return true; // 格式不符，视为残留
  }

  const pid = Number(pidMatch[1].trim());
  const host = hostMatch[1].trim();

  if (!Number.isFinite(pid)) {
    return true;
  }

  /*
   * 不同主机的锁无法本地验证存活，保守视为仍活跃，避免误抢。
   */
  if (host !== os.hostname()) {
    return false;
  }

  return !isProcessAlive(pid);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH 表示进程不存在；EPERM 表示存在但无权限，视为存活。
    return error.code === 'EPERM';
  }
}

function ensureGitRepository(context) {
  runGit(context, ['rev-parse', '--is-inside-work-tree'], { capture: true });
}

function ensureCleanWorkingTree(context) {
  const changedFiles = getChangedFiles(context);

  if (changedFiles.length > 0) {
    throw new Error(`工作区不干净，请先处理这些文件：\n${changedFiles.join('\n')}`);
  }
}

function ensureBranch(context, branch) {
  const currentBranch = runGit(context, ['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true }).trim();

  if (currentBranch === branch) {
    return;
  }

  const branches = runGit(context, ['branch', '--list', branch], { capture: true }).trim();

  if (branches) {
    runGit(context, ['switch', branch]);
  } else {
    /*
     * base 模式把新 task 分支固定创建在配置的 base_branch 上。
     * chained 模式保留原先“从当前分支继续创建”的行为，适合一串强依赖任务
     * 逐个落地并让后续 task 直接继承前序提交。
     */
    if (context.branchPolicy.mode === 'base') {
      runGit(context, ['rev-parse', '--verify', context.branchPolicy.baseBranch], { capture: true });
      runGit(context, ['switch', context.branchPolicy.baseBranch]);
    }

    runGit(context, ['switch', '-c', branch]);
  }
}

function ensureGitCommitIdentity(context) {
  const userName = readGitConfig(context, 'user.name');
  const userEmail = readGitConfig(context, 'user.email');

  if (!userName || !userEmail) {
    throw new Error('git 缺少 user.name 或 user.email，Runner 无法自动提交。');
  }
}

function ensureClaudeAvailable(context) {
  const command = process.env.AI_RUNNER_CLAUDE_BIN || 'claude';
  const checker = process.platform === 'win32'
    ? { command: 'where', args: [command], shell: false }
    : { command: 'sh', args: ['-lc', `command -v ${shellQuote(command)}`], shell: false };
  const result = spawnSync(checker.command, checker.args, {
    cwd: context.projectRoot,
    encoding: 'utf8',
    shell: checker.shell
  });

  if (result.status !== 0) {
    throw new Error(`没有找到 Claude Code 命令：${command}`);
  }
}

function readGitConfig(context, key) {
  const result = spawnSync('git', ['config', '--get', key], {
    cwd: context.projectRoot,
    encoding: 'utf8',
    shell: false
  });

  return result.status === 0 ? result.stdout.trim() : '';
}

function snapshotRunnerOwnedFiles(context, task) {
  /*
   * Runner 只拥有当前 task 状态文件。
   * Claude 执行前先记录快照，执行后必须保持完全一致，
   * 这样 AI 无法偷偷改 task body、状态、verify 或路径边界。
   */
  return new Map([
    [task.relativePath, readFileSync(resolveProjectPath(context, task.relativePath), 'utf8')]
  ]);
}

function ensureRunnerOwnedFilesUnchanged(context, snapshots) {
  for (const [relativePath, expectedContent] of snapshots) {
    const filePath = resolveProjectPath(context, relativePath);
    const actualContent = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';

    if (actualContent !== expectedContent) {
      throw new Error(`AI 修改了 Runner 拥有的文件：${relativePath}`);
    }
  }
}

function ensureTaskChangedSomething(context, task, runnerOwnedSnapshots) {
  if (task.meta.allow_empty_code_changes === true) {
    return;
  }

  const agentChangedFiles = getAgentChangedFiles(context, runnerOwnedSnapshots);

  if (agentChangedFiles.length === 0) {
    throw new Error('Claude 没有产生 agent_allowed_paths 内的代码改动，任务不会被自动提交。');
  }
}

function validateAgentChangedPaths(context, task, runnerOwnedSnapshots) {
  ensureRunnerOwnedFilesUnchanged(context, runnerOwnedSnapshots);

  const blockedFiles = collectAgentPathViolations(context, task, runnerOwnedSnapshots);

  if (blockedFiles.length > 0) {
    throw new Error(`检测到超出 agent_allowed_paths 的改动：\n${blockedFiles.join('\n')}`);
  }
}

/*
 * 即使 Claude 主动 blocked 或执行失败，也必须先确认它没有越界修改。
 * 失败状态不能成为绕过路径边界的出口，否则下一轮 Runner 会在污染后的工作区上运行。
 */
function assertPostRunSafety(context, task, runnerOwnedSnapshots) {
  ensureRunnerOwnedFilesUnchanged(context, runnerOwnedSnapshots);

  const blockedFiles = collectAgentPathViolations(context, task, runnerOwnedSnapshots);

  if (blockedFiles.length > 0) {
    throw new Error(`任务停止前产生了超出 agent_allowed_paths 的改动：\n${blockedFiles.join('\n')}`);
  }
}

function collectAgentPathViolations(context, task, runnerOwnedSnapshots) {
  const allowedPaths = normalizeArray(task.meta.agent_allowed_paths).map(normalizeAllowedPath);

  return getAgentChangedFiles(context, runnerOwnedSnapshots)
    .filter((filePath) => !isAllowedFile(filePath, allowedPaths));
}

function getAgentChangedFiles(context, runnerOwnedSnapshots) {
  const runnerOwnedPaths = new Set([...runnerOwnedSnapshots.keys()].map(normalizeAllowedPath));

  return getChangedFiles(context).filter((filePath) => !runnerOwnedPaths.has(normalizeAllowedPath(filePath)));
}

function assertClaudeExecutionSucceeded(context, task, runnerOwnedSnapshots, claudeResult) {
  const blockedReason = extractBlockedReason(claudeResult.resultText, claudeResult.stdout);

  if (blockedReason) {
    assertPostRunSafety(context, task, runnerOwnedSnapshots);
    markTaskStatus(context, task, TASK_STATUS.blocked, blockedReason);
    throw new Error(`任务被标记为 blocked：${blockedReason}`);
  }

  const processFailed = claudeResult.exitCode !== 0 || claudeResult.timedOut || claudeResult.streamError;

  if (processFailed) {
    assertPostRunSafety(context, task, runnerOwnedSnapshots);
    const detail = claudeResult.timedOut
      ? 'Claude Code 执行超时'
      : `Claude Code 执行失败，退出码：${claudeResult.exitCode}`;
    throw new RetryableRunnerError(detail);
  }
}

async function runClaudeTask(context, task, logPath, options = {}) {
  const prompt = buildPrompt(context, task, options.extraInstructions || '');
  const claudeBin = process.env.AI_RUNNER_CLAUDE_BIN || 'claude';
  const allowedTools = uniqueValues([
    ...DEFAULT_IMPLEMENTATION_ALLOWED_TOOLS,
    ...normalizeArray(task.meta.allowed_tools).map((tool) => String(tool).trim()).filter(Boolean)
  ]);
  /*
   * 每次执行都按当前 task 重新生成 enforcement 产物：
   * 一个 PreToolUse 钩子配置（经 --settings 注入）和一个路径上下文（经环境变量传给钩子）。
   * 这样 agent_allowed_paths 在工具调用层被事前强制，越界编辑即时被拒。
   */
  const enforcement = writeEnforcementArtifacts(context, task, logPath);
  const baseArgs = buildClaudeBaseArgs({
    settingsPath: enforcement.settingsPath,
    maxTurns: context.claudeMaxTurns,
    allowedTools
  });
  const { command, args } = createClaudeCommand({
    command: claudeBin,
    prompt,
    logPath,
    baseArgs
  });

  appendLog(logPath, `启动 Claude Code：${claudeBin} ${baseArgs.join(' ')} -p <task-prompt>`);
  console.log(`启动 Claude Code：${claudeBin} ${baseArgs.join(' ')} -p <task-prompt>`);

  const rawResult = await runCommand(context, command, args, {
    shell: false,
    capture: true,
    streamJson: true,
    timeoutMs: context.claudeTimeoutMs,
    logPath,
    rejectOnFailure: false,
    env: { ...process.env, AI_RUNNER_TASK_CONTEXT: enforcement.contextPath }
  });

  const parsed = parseClaudeStreamJson(rawResult.stdout);

  return { ...rawResult, ...parsed };
}

/*
 * 组装 Claude 启动参数：
 * default 权限模式配合 allowedTools 显式放行必要工具；
 * --settings 注入 PreToolUse 钩子，在工具调用层事前拦截越界编辑；
 * --output-format stream-json 让结果可结构化解析，替代脆弱的文本 grep；
 * --verbose 是 stream-json 在 --print 模式下的硬性前置条件，缺失时 Claude CLI 直接报错退出；
 * --max-turns 给回合上限防止死循环；
 * --allowedTools 按 task 声明精确放行额外工具，取代危险的 bypassPermissions 全开模式。
 */
function buildClaudeBaseArgs({ settingsPath, maxTurns, allowedTools }) {
  const args = ['--permission-mode', 'default'];

  if (settingsPath) {
    args.push('--settings', settingsPath);
  }

  args.push('--output-format', 'stream-json');
  args.push('--verbose');

  if (maxTurns) {
    args.push('--max-turns', String(maxTurns));
  }

  for (const tool of allowedTools) {
    args.push('--allowedTools', tool);
  }

  return args;
}

function createClaudeCommand({ command, prompt, logPath = '', baseArgs = [] }) {
  if (process.platform === 'win32') {
    return createWindowsClaudeCommand(command, prompt, logPath, baseArgs);
  }

  return { command, args: [...baseArgs, '-p', prompt] };
}

/*
 * Windows 上的全局 CLI 经常是 .cmd 包装器，不能可靠地用 shell:false 直接启动。
 * 这里把多行 prompt 写入日志目录旁的文件，再用 PowerShell 读取后作为参数传入，
 * 避免把大段 prompt 拼进 cmd 命令行造成截断、转义错误或命令注入。
 * 每个 baseArg 都做 PowerShell 单引号转义，保证含空格的 --settings 路径或工具规格不会破坏命令。
 */
function createWindowsClaudeCommand(command, prompt, logPath, baseArgs = []) {
  if (!logPath) {
    return { command, args: [...baseArgs, '-p', prompt] };
  }

  const promptPath = `${logPath}.prompt.md`;
  writeFileSync(promptPath, prompt, 'utf8');
  const quotedArgs = baseArgs.map(toPowerShellSingleQuoted).join(' ');

  const script = [
    '$ErrorActionPreference = "Stop"',
    '$ProgressPreference = "SilentlyContinue"',
    /*
     * Windows PowerShell 5.1 默认会按系统 ANSI 编码读取无 BOM 的 UTF-8 文件。
     * 执行 prompt 包含大量中文约束，必须显式指定 UTF-8，
     * 否则 Claude 收到的上下文会乱码，Runner 的边界规则也会失真。
     */
    `$prompt = Get-Content -Raw -Encoding UTF8 -LiteralPath ${toPowerShellSingleQuoted(promptPath)}`,
    `& ${toPowerShellSingleQuoted(command)} ${quotedArgs} -p $prompt`,
    'exit $LASTEXITCODE'
  ].join('\n');

  return {
    command: 'powershell.exe',
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')
    ]
  };
}

/*
 * 生成 PreToolUse 钩子配置和路径上下文文件，二者配合实现 agent_allowed_paths 的事前强制。
 * 钩子脚本通过环境变量 AI_RUNNER_TASK_CONTEXT 找到上下文，对越界 Edit/Write 以非零退出码阻断。
 */
function writeEnforcementArtifacts(context, task, logPath) {
  const allowedPaths = normalizeArray(task.meta.agent_allowed_paths).map(normalizeAllowedPath);
  const protectedFiles = [task.relativePath, task.meta.spec, task.meta.plan]
    .map(normalizeAllowedPath)
    .filter(Boolean);

  const contextPayload = {
    taskId: String(task.meta.id),
    projectRoot: context.projectRoot,
    allowedPaths,
    protectedFiles,
    forbiddenPatterns: context.forbiddenAgentPathPatterns
  };
  const contextPath = `${logPath}.task-context.json`;
  writeFileSync(contextPath, JSON.stringify(contextPayload, null, 2), 'utf8');

  const hookScript = toPosix(path.join(context.runnerRoot, 'scripts', 'ai-enforce-paths.mjs'));
  const settingsPayload = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash',
          hooks: [
            { type: 'command', command: `node ${hookScript}` }
          ]
        }
      ]
    }
  };
  const settingsPath = `${logPath}.settings.json`;
  writeFileSync(settingsPath, JSON.stringify(settingsPayload, null, 2), 'utf8');

  return { contextPath, settingsPath };
}

/*
 * 解析 Claude 的 stream-json 输出，提取最终结果文本与是否出错。
 * 任何解析失败都降级为空值，blocked 识别会回退到原始 stdout，不会破坏既有流程。
 */
function parseClaudeStreamJson(stdout) {
  const parsed = { resultText: '', streamError: false, numTurns: null };

  if (!stdout) {
    return parsed;
  }

  const lines = stdout.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || !trimmed.startsWith('{')) {
      continue;
    }

    let event;

    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (event.type === 'result') {
      parsed.resultText = String(event.result || '');
      parsed.streamError = event.subtype === 'error';

      if (Number.isFinite(event.num_turns)) {
        parsed.numTurns = event.num_turns;
      }
    }
  }

  return parsed;
}

/*
 * stream-json 模式下，原始流完整落盘便于事后排查，但终端只回显 assistant 的文本增量，
 * 避免把整段 JSON 刷屏。result 事件由 Runner 自己汇总，不在这里重复打印。
 */
/*
 * 把 Claude stream-json 的一行事件转换成终端可实时阅读的回显。
 * assistant 事件回显 AI 的思考文本和每一次工具调用摘要，
 * user 事件回显工具执行出错标记；其余事件交给 Runner 在日志文件里完整留痕。
 * projectRoot 用于把工具入参里的绝对路径转成项目内相对路径，避免 Windows 长路径刷屏。
 */
function extractStreamJsonDisplay(line, projectRoot = '') {
  const trimmed = line.trim();

  if (!trimmed) {
    return '';
  }

  if (!trimmed.startsWith('{')) {
    return trimmed;
  }

  let event;

  try {
    event = JSON.parse(trimmed);
  } catch {
    return trimmed;
  }

  if (event.type === 'assistant' && event.message && Array.isArray(event.message.content)) {
    return summarizeAssistantContent(event.message.content, projectRoot);
  }

  if (event.type === 'user' && event.message && Array.isArray(event.message.content)) {
    return summarizeToolResultContent(event.message.content);
  }

  /*
   * result 事件是 Claude 一次执行的终态：成功时由 Runner 自行汇总，不在实时流重复；
   * 只有 subtype=error 的失败终态需要立刻回显，让网络/API/限流类错误不再等到进程结束才暴露。
   */
  if (event.type === 'result' && event.subtype === 'error') {
    return `[Claude 错误] ${String(event.result || '').trim() || '执行出错，详见日志'}`;
  }

  /*
   * 兜底：捕获未识别事件结构里的错误信号。
   * Claude Code 的非 result 错误事件字段尚未完全契约化，这里按 subtype/type 命中并回显原文，
   * 既不漏报也不崩溃；正常事件仍静默，交由日志文件完整留痕。
   */
  if (event.subtype === 'error' || event.type === 'error') {
    const detail = String(event.message || event.result || event.error || '执行出错').trim();
    return `[Claude 错误] ${detail}`;
  }

  return '';
}

/*
 * 汇总 assistant 一次消息里的文本与工具调用。
 * 文本块原样输出保留 AI 的推理上下文，工具调用块输出一行摘要，
 * 二者按出现顺序拼接，让终端读者能同时看到「为什么」和「在做什么」。
 */
function summarizeAssistantContent(content, projectRoot) {
  const lines = [];

  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }

    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      lines.push(block.text);
      continue;
    }

    if (block.type === 'tool_use') {
      const summary = summarizeToolUse(block.name, block.input, projectRoot);

      if (summary) {
        lines.push(summary);
      }
    }
  }

  return lines.join('\n');
}

/*
 * 把一次工具调用格式化成单行摘要，例如「[工具] Edit · src/App.tsx」。
 * 文件类工具展示被操作路径，Bash 展示命令，搜索类展示 pattern/query，
 * 让执行过程可观测，又不会把完整入参（可能含大段 diff 或代码）刷到终端。
 */
function summarizeToolUse(toolName, input, projectRoot) {
  const name = String(toolName || '工具').trim() || '工具';
  const detail = pickToolUseDetail(input || {}, projectRoot);

  return detail ? `[工具] ${name} · ${detail}` : `[工具] ${name}`;
}

function pickToolUseDetail(input, projectRoot) {
  const filePath = input.file_path || input.notebook_path || input.path;

  if (typeof filePath === 'string' && filePath) {
    return relativizeForDisplay(filePath, projectRoot);
  }

  if (typeof input.command === 'string' && input.command.trim()) {
    return truncateForDisplay(input.command);
  }

  if (typeof input.pattern === 'string' && input.pattern.trim()) {
    return `pattern=${truncateForDisplay(input.pattern)}`;
  }

  if (typeof input.query === 'string' && input.query.trim()) {
    return `query=${truncateForDisplay(input.query)}`;
  }

  return '';
}

/*
 * tool_result 通常体积很大，正文由日志文件完整保留即可。
 * 终端只在工具出错时回显一行标记，避免成功结果把屏幕刷满，
 * 同时让失败的工具调用在实时流里立刻可见。
 */
function summarizeToolResultContent(content) {
  const lines = [];

  for (const block of content) {
    if (block && block.type === 'tool_result' && block.is_error) {
      lines.push('[工具结果] 执行出错，详见日志');
    }
  }

  return lines.join('\n');
}

function truncateForDisplay(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();

  if (value.length <= TOOL_USE_DISPLAY_LIMIT) {
    return value;
  }

  return `${value.slice(0, TOOL_USE_DISPLAY_LIMIT)}…`;
}

/*
 * 把工具入参里的绝对路径转成项目内相对路径用于回显。
 * 仅做展示层归一化，不影响 Claude 实际收到的路径；项目外或已是相对路径则原样返回。
 */
function relativizeForDisplay(filePath, projectRoot) {
  const value = String(filePath || '');

  if (!value || !projectRoot) {
    return value;
  }

  const normalizedProject = toPosix(projectRoot).replace(/\/+$/, '');
  const normalizedFile = toPosix(value);

  if (normalizedFile === normalizedProject) {
    return '.';
  }

  if (normalizedFile.startsWith(`${normalizedProject}/`)) {
    return normalizedFile.slice(normalizedProject.length + 1);
  }

  return value;
}

function buildPrompt(context, task, extraInstructions = '') {
  /*
   * 执行 prompt 是 Runner 和 AI 之间的关键契约。
   * 模板缺失时必须直接失败，不能用内置默认内容继续执行，
   * 否则会绕过最新的路径、状态和阻断规则。
   */
  if (!existsSync(context.promptTemplatePath)) {
    throw new Error(`缺少执行 prompt 模板：${toPosix(context.promptTemplatePath)}`);
  }

  const template = readFileSync(context.promptTemplatePath, 'utf8');

  const basePrompt = template
    .replaceAll('{taskId}', String(task.meta.id))
    .replaceAll('{taskTitle}', task.title)
    .replaceAll('{taskPath}', task.relativePath)
    .replaceAll('{specPath}', String(task.meta.spec))
    .replaceAll('{planPath}', String(task.meta.plan))
    .replaceAll('{agentAllowedPaths}', normalizeArray(task.meta.agent_allowed_paths).map((item) => `- ${item}`).join('\n'))
    .replaceAll('{verifyCommands}', normalizeArray(task.meta.verify).map((item) => `- ${item}`).join('\n'));

  if (!extraInstructions) {
    return basePrompt;
  }

  return `${basePrompt}\n\n${extraInstructions}`;
}

async function runVerifyCommands(context, task, logPath, runnerOwnedSnapshots) {
  const verifyCommands = normalizeArray(task.meta.verify);

  for (const command of verifyCommands) {
    appendLog(logPath, `运行验证命令：${command}`);
    console.log(`运行验证命令：${command}`);

    const result = await runCommand(context, command, [], {
      shell: true,
      capture: true,
      timeoutMs: context.verifyTimeoutMs,
      logPath,
      rejectOnFailure: false
    });

    if (result.exitCode !== 0 || result.timedOut) {
      throw new VerifyFailureError(command, result);
    }

    ensureRunnerOwnedFilesUnchanged(context, runnerOwnedSnapshots);
  }
}

async function runVerifyWithRepairs(context, task, logPath, runnerOwnedSnapshots) {
  /*
   * verify 失败时，把失败命令和输出回灌给同一个 task 的 Claude 上下文。
   * 修复仍然受 agent_allowed_paths、Runner 文件快照和 PreToolUse 钩子约束，
   * 因此不会为了通过测试而扩散到任务边界之外。
   */
  for (let repairAttempt = 0; repairAttempt <= context.verifyRepairAttempts; repairAttempt += 1) {
    try {
      await runVerifyCommands(context, task, logPath, runnerOwnedSnapshots);
      return;
    } catch (error) {
      if (!(error instanceof VerifyFailureError)) {
        throw error;
      }

      validateAgentChangedPaths(context, task, runnerOwnedSnapshots);

      if (repairAttempt >= context.verifyRepairAttempts) {
        throw error;
      }

      const nextAttempt = repairAttempt + 1;
      appendLog(logPath, `验证失败，启动第 ${nextAttempt} 次 Claude 修复：${error.message}`);
      console.log(`验证失败，启动第 ${nextAttempt} 次 Claude 修复。`);

      const repairResult = await runClaudeTask(context, task, logPath, {
        extraInstructions: buildVerifyRepairInstructions(error, nextAttempt, context.verifyRepairAttempts)
      });

      assertClaudeExecutionSucceeded(context, task, runnerOwnedSnapshots, repairResult);
      ensureRunnerOwnedFilesUnchanged(context, runnerOwnedSnapshots);
      validateAgentChangedPaths(context, task, runnerOwnedSnapshots);
    }
  }
}

function buildVerifyRepairInstructions(error, attempt, maxAttempts) {
  const result = error.result || {};
  const output = truncateText([
    result.stdout ? `stdout:\n${result.stdout}` : '',
    result.stderr ? `stderr:\n${result.stderr}` : ''
  ].filter(Boolean).join('\n\n'), TEXT_SNIPPET_LIMIT);

  return [
    '## 验证失败后的修复要求',
    '',
    `这是第 ${attempt}/${maxAttempts} 次验证失败修复机会。`,
    '请只修复导致当前验证失败的问题，不要扩大任务范围，不要修改 task/SPEC/PLAN/Runner 文件，不要提交 git commit。',
    '如果失败原因说明任务边界或架构前提有问题，请停止实现并输出：AI_TASK_BLOCKED: 原因。',
    '',
    `失败命令：${error.command}`,
    `执行结果：${result.timedOut ? '超时' : `退出码 ${result.exitCode}`}`,
    '',
    '验证输出：',
    '```text',
    output || '无输出',
    '```'
  ].join('\n');
}

async function runImplementationReview(context, task, logPath, runnerOwnedSnapshots) {
  const changedFiles = getAgentChangedFiles(context, runnerOwnedSnapshots);
  const prompt = buildImplementationReviewPrompt(context, task, changedFiles);
  const claudeBin = process.env.AI_RUNNER_CLAUDE_BIN || 'claude';
  const baseArgs = buildClaudeBaseArgs({
    settingsPath: '',
    maxTurns: context.reviewMaxTurns,
    allowedTools: REVIEW_ALLOWED_TOOLS
  });
  const { command, args } = createClaudeCommand({
    command: claudeBin,
    prompt,
    logPath,
    baseArgs
  });

  appendLog(logPath, `启动只读实现审查：${claudeBin} ${baseArgs.join(' ')} -p <review-prompt>`);
  console.log('启动只读实现审查。');

  const rawResult = await runCommand(context, command, args, {
    shell: false,
    capture: true,
    streamJson: true,
    timeoutMs: context.claudeTimeoutMs,
    logPath,
    rejectOnFailure: false,
    env: process.env
  });
  const parsed = parseClaudeStreamJson(rawResult.stdout);
  const reviewText = [parsed.resultText, rawResult.stdout].filter(Boolean).join('\n');

  if (rawResult.exitCode !== 0 || rawResult.timedOut || parsed.streamError) {
    const detail = rawResult.timedOut
      ? '只读实现审查超时'
      : `只读实现审查失败，退出码：${rawResult.exitCode}`;
    throw new RetryableRunnerError(detail);
  }

  const failedReason = extractReviewFailure(reviewText);

  if (failedReason) {
    throw new Error(`只读实现审查未通过：${failedReason}`);
  }

  if (!reviewText.includes(REVIEW_PASSED_SIGNAL)) {
    throw new Error(`只读实现审查没有输出明确通过信号：${REVIEW_PASSED_SIGNAL}`);
  }
}

function buildImplementationReviewPrompt(context, task, changedFiles) {
  /*
   * 审查 prompt 只注入当前 task 的契约、变更文件和 diff。
   * 它不要求审查 agent 执行命令，也不给任何写权限；
   * 如果 diff 被截断，审查 agent 仍可用只读工具打开 changedFiles 中的文件核对。
   */
  const diff = readAgentDiff(context, changedFiles);
  const allowedPaths = normalizeArray(task.meta.agent_allowed_paths).map((item) => `- ${item}`).join('\n');
  const verifyCommands = normalizeArray(task.meta.verify).map((item) => `- ${item}`).join('\n');
  const changedFileList = changedFiles.length > 0
    ? changedFiles.map((filePath) => `- ${filePath}`).join('\n')
    : '- 无';

  return [
    '你是一个全新上下文中的只读代码审查 agent。',
    '',
    '请只做实现审查，不要修改任何文件，不要提交 git，不要运行会改变工作区的命令。',
    '',
    `任务：${task.meta.id} - ${task.title}`,
    `任务文件：${task.relativePath}`,
    `规格文件：${task.meta.spec}`,
    `计划文件：${task.meta.plan}`,
    '',
    'AI 允许修改路径：',
    allowedPaths,
    '',
    'Runner 已执行并通过的验证命令：',
    verifyCommands,
    '',
    '本 task 变更文件：',
    changedFileList,
    '',
    '请重点检查：',
    '1. 是否只完成当前 task，没有实现后续 task。',
    '2. 是否符合 SPEC、PLAN、AGENTS.md 和当前 task 的边界。',
    '3. 是否存在跨层耦合、重复逻辑、临时 patch、魔法逻辑或隐式状态。',
    '4. 是否有明显缺测、错误处理缺口或会破坏后续 task 的风险。',
    '5. 是否存在应该 blocked 而不是继续提交的架构问题。',
    '',
    `如果发现必须阻断的问题，最后单独输出：${REVIEW_FAILED_SIGNAL} 原因`,
    `如果没有必须阻断的问题，最后单独输出：${REVIEW_PASSED_SIGNAL}`,
    '',
    '当前 diff：',
    '```diff',
    diff || '无可展示 diff；如有未跟踪文件，请根据变更文件列表用只读工具查看。',
    '```'
  ].join('\n');
}

function readAgentDiff(context, changedFiles) {
  if (changedFiles.length === 0) {
    return '';
  }

  try {
    return truncateText(runGit(context, ['diff', '--', ...changedFiles], { capture: true }), TEXT_SNIPPET_LIMIT);
  } catch {
    return '';
  }
}

function extractReviewFailure(text) {
  const match = new RegExp(`${escapeRegExp(REVIEW_FAILED_SIGNAL)}\\s*(.+)`).exec(text);

  return match ? match[1].trim() : '';
}

function commitTask(context, task) {
  const changedFiles = getChangedFiles(context);

  if (changedFiles.length === 0) {
    throw new Error('没有可提交的改动。');
  }

  runGit(context, ['add', '--all', '--', ...changedFiles]);
  runGit(context, ['commit', '-m', String(task.meta.commit)]);
}

function createTaskLog(context, task) {
  mkdirSync(context.logDir, {
    recursive: true
  });

  const safeTaskId = String(task.meta.id).replace(/[^A-Za-z0-9_-]+/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(context.logDir, `${timestamp}_${safeTaskId}.log`);

  appendLog(logPath, [
    `task=${task.meta.id}`,
    `branch=${task.meta.branch}`,
    `started_at=${new Date().toISOString()}`,
    ''
  ].join('\n'));

  return logPath;
}

function appendLog(logPath, text) {
  appendFileSync(logPath, `${text}\n`, 'utf8');
}

function printDryRunTask(task) {
  /*
   * dry-run 是纯预览模式。
   * 它不切分支、不写状态、不创建日志、不检查 Claude，
   * 只展示 Runner 在真实执行时会选择的任务和边界。
   */
  console.log(`dry-run：将执行 ${task.meta.id} - ${task.title}`);
  console.log(`分支：${task.meta.branch}`);
  console.log('AI 允许修改路径：');

  for (const allowedPath of normalizeArray(task.meta.agent_allowed_paths)) {
    console.log(`- ${allowedPath}`);
  }

  console.log('验证命令：');

  for (const command of normalizeArray(task.meta.verify)) {
    console.log(`- ${command}`);
  }
}

function getChangedFiles(context) {
  const unstaged = runGit(context, ['diff', '--name-only'], { capture: true });
  const staged = runGit(context, ['diff', '--name-only', '--cached'], { capture: true });
  const untracked = runGit(context, ['ls-files', '--others', '--exclude-standard'], { capture: true });

  /*
   * git 返回的路径始终相对「git 仓库根」，而 Runner 内部的 task.relativePath、
   * agent_allowed_paths、runnerOwnedSnapshots 等全部相对「projectRoot」。
   * 当 projectRoot 只是 git 仓库的某个子目录时，必须先剥离 show-prefix 这段前缀，
   * 否则 task 状态文件（由 Runner 自身改写）会被误判成 AI 的越界改动，
   * commit/diff 等后续 git 操作也会因为路径基准不一致而失真。
   */
  return uniqueLines(`${unstaged}\n${staged}\n${untracked}`)
    .map((filePath) => stripGitPathPrefix(context, filePath))
    .filter((filePath) => !isRunnerIgnoredChangedPath(context, filePath));
}

/*
 * 计算 projectRoot 在 git 仓库内的相对前缀（git rev-parse --show-prefix）。
 * 例如 projectRoot=C:/code/ai-opc/agv-3d 而 git 仓库根=C:/code/ai-opc 时，返回 "agv-3d/"；
 * projectRoot 恰好是仓库根时返回空字符串。结果惰性缓存到 context，避免每次取变更都重复调用 git。
 */
function getGitPathPrefix(context) {
  if (context.gitPathPrefix === undefined) {
    context.gitPathPrefix = toPosix(runGit(context, ['rev-parse', '--show-prefix'], { capture: true }).trim());
  }

  return context.gitPathPrefix;
}

/*
 * 把 git 返回的仓库根相对路径转换成 projectRoot 相对路径。
 * 只剥离精确匹配的前缀；前缀为空（仓库根即 projectRoot）或路径不以该前缀开头时原样返回。
 */
function stripGitPathPrefix(context, filePath) {
  const prefix = getGitPathPrefix(context);

  if (!prefix) {
    return toPosix(filePath);
  }

  const normalized = toPosix(filePath);

  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length);
  }

  return normalized;
}

function isRunnerIgnoredChangedPath(context, filePath) {
  const normalizedPath = normalizeAllowedPath(filePath);
  const configuredIgnoredPaths = [
    toProjectRelativePath(context, context.lockFile),
    toProjectRelativePath(context, context.logDir)
  ].filter(Boolean);
  const ignoredPaths = [
    ...RUNNER_IGNORED_CHANGED_PATHS,
    ...configuredIgnoredPaths
  ].map(normalizeAllowedPath);

  return ignoredPaths.some((ignoredPath) => {
    return normalizedPath === ignoredPath || normalizedPath.startsWith(`${ignoredPath}/`);
  });
}

function runGit(context, args, options = {}) {
  return runCommandSync(context, 'git', args, options);
}

function runCommandSync(context, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: context.projectRoot,
    encoding: 'utf8',
    shell: options.shell || false
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} ${args.join(' ')} 执行失败`);
  }

  return result.stdout || '';
}

async function runCommand(context, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: context.projectRoot,
      shell: options.shell || false,
      env: options.env || process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = Number(options.timeoutMs || 0);
    const timer = timeout > 0
      ? setTimeout(() => {
          timedOut = true;
          terminateProcess(child);
        }, timeout)
      : null;

    let streamJsonBuffer = '';

    if (options.capture) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        appendLog(options.logPath, text.trimEnd());

        if (options.streamJson) {
          /*
           * stream-json 输出按行分隔。逐行解析后只回显 assistant 文本增量，
           * 原始 JSON 流仍完整保留在 stdout 和日志里供事后解析。
           */
          streamJsonBuffer += text;
          let newlineIndex = streamJsonBuffer.indexOf('\n');

          while (newlineIndex !== -1) {
            const line = streamJsonBuffer.slice(0, newlineIndex);
            streamJsonBuffer = streamJsonBuffer.slice(newlineIndex + 1);
            newlineIndex = streamJsonBuffer.indexOf('\n');

            const display = extractStreamJsonDisplay(line, context.projectRoot);

            if (display) {
              process.stdout.write(display.endsWith('\n') ? display : `${display}\n`);
            }
          }
        } else {
          process.stdout.write(text);
        }
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        appendLog(options.logPath, text.trimEnd());
        process.stderr.write(text);
      });
    }

    child.on('error', (error) => {
      if (timer) {
        clearTimeout(timer);
      }

      reject(error);
    });

    child.on('close', (code) => {
      if (timer) {
        clearTimeout(timer);
      }

      const exitCode = timedOut ? -1 : code;
      const result = {
        exitCode,
        stdout,
        stderr,
        timedOut
      };

      if (timedOut) {
        const message = `${command} 执行超时，已停止进程。`;

        if (options.rejectOnFailure !== false) {
          reject(new Error(message));
          return;
        }

        stderr += `\n${message}`;
        result.stderr = stderr;
        resolve(result);
        return;
      }

      if (exitCode !== 0 && options.rejectOnFailure !== false) {
        reject(new Error(stderr || stdout || `${command} 执行失败，退出码：${exitCode}`));
        return;
      }

      resolve(result);
    });
  });
}

function terminateProcess(child) {
  /*
   * verify 和 Claude 都可能派生子进程。
   * Windows 下用 taskkill 结束进程树；其它平台先发 SIGTERM，
   * 让命令有机会自行清理，Runner 再等待 close 事件收尾。
   */
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      encoding: 'utf8',
      shell: false
    });
    return;
  }

  child.kill('SIGTERM');
}

function extractBlockedReason(resultText, rawOutput) {
  /*
   * 优先从结构化结果文本识别 blocked 信号（stream-json 的 result 字段是干净的 Claude 输出）；
   * 解析失败或没有结果文本时回退到原始 stdout，保证旧行为不丢失。
   */
  const sources = [resultText, rawOutput].filter(Boolean);

  for (const source of sources) {
    const match = /AI_TASK_BLOCKED:\s*(.+)/.exec(source);

    if (match) {
      return match[1].trim();
    }
  }

  return '';
}

function extractTitle(body) {
  const heading = body.split(/\r?\n/).find((line) => line.startsWith('# '));
  return heading ? heading.replace(/^#\s+/, '').trim() : '未命名任务';
}

function normalizeArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function truncateText(text, limit) {
  const value = String(text || '');

  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n\n[内容过长，已截断 ${value.length - limit} 个字符]`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeAllowedPath(filePath) {
  return toPosix(String(filePath || '')).replace(/^\.?\//, '').replace(/\/+$/, '');
}

function isProtectedRunnerFile(filePath, protectedFiles) {
  const normalizedPath = normalizeAllowedPath(filePath);

  return protectedFiles.some((protectedFile) => {
    return normalizedPath === protectedFile || normalizedPath.startsWith(`${protectedFile}/`);
  });
}

function matchesAnyPathPattern(filePath, patterns) {
  const normalizedPath = normalizeAllowedPath(filePath);

  return patterns.some((pattern) => pathPatternToRegExp(pattern).test(normalizedPath));
}

/*
 * 这里只实现 Runner 需要的最小 glob 语义。
 * 单星号匹配一个路径片段内的任意字符，双星号匹配跨目录内容，
 * 避免为了受保护路径判断引入额外依赖和新的跨项目安装成本。
 */
function pathPatternToRegExp(pattern) {
  const normalizedPattern = normalizeAllowedPath(pattern);
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '__AI_RUNNER_DOUBLE_STAR__')
    .replaceAll('*', '[^/]*')
    .replaceAll('__AI_RUNNER_DOUBLE_STAR__', '.*');

  return new RegExp(`^${escaped}$`);
}

function isAllowedFile(filePath, allowedPaths) {
  const normalizedFilePath = normalizeAllowedPath(filePath);

  return allowedPaths.some((allowedPath) => {
    if (!allowedPath) {
      return false;
    }

    return normalizedFilePath === allowedPath || normalizedFilePath.startsWith(`${allowedPath}/`);
  });
}

function hasAllowedCommandPrefix(command, allowPrefixes) {
  return allowPrefixes.some((prefix) => command === prefix || command.startsWith(`${prefix} `));
}

function uniqueLines(text) {
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

function toPosix(filePath) {
  return String(filePath).split(path.sep).join('/');
}

function toProjectRelativePath(context, targetPath) {
  if (!isInsideRoot(context.projectRoot, targetPath)) {
    return '';
  }

  return toPosix(path.relative(context.projectRoot, targetPath));
}

function isInsideRoot(root, targetPath) {
  const relativePath = path.relative(path.resolve(root), path.resolve(targetPath));

  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function resolveProjectPath(context, relativePath) {
  const absolutePath = path.resolve(context.projectRoot, relativePath);
  const relativeFromRoot = path.relative(context.projectRoot, absolutePath);

  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    throw new Error(`路径必须位于项目内：${relativePath}`);
  }

  return absolutePath;
}

function resolveContext(options) {
  if (options && options.projectRoot && options.taskDir && options.promptTemplatePath) {
    return options;
  }

  return createRunnerContext(options);
}

function requireNextArg(argv, index, name) {
  const value = argv[index + 1];

  if (!value || value.startsWith('--')) {
    throw new Error(`${name} 缺少参数值。`);
  }

  return value;
}

function readTimeoutMs(envName, defaultValue) {
  const rawValue = process.env[envName];

  if (!rawValue) {
    return defaultValue;
  }

  const timeout = Number(rawValue);

  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`${envName} 必须是正整数毫秒值。`);
  }

  return timeout;
}

function readPositiveInt(envName, defaultValue) {
  const rawValue = process.env[envName];

  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value < 1 || !Number.isInteger(value)) {
    throw new Error(`${envName} 必须是正整数。`);
  }

  return value;
}

function readNonNegativeInt(envName, defaultValue) {
  const rawValue = process.env[envName];

  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`${envName} 必须是非负整数。`);
  }

  return value;
}

function shellQuote(value) {
  /*
   * 非 Windows 环境下用 command -v 检查可执行文件。
   * 这里做最小 shell 转义，避免自定义命令路径中包含空格或引号时破坏检查命令。
   */
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function toPowerShellSingleQuoted(value) {
  /*
   * PowerShell 单引号字符串用两个单引号表达字面量单引号。
   * Claude 命令和 prompt 文件路径都通过这里进入脚本，避免破坏 EncodedCommand。
   */
  return `'${String(value).replaceAll("'", "''")}'`;
}
