import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, appendFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
const RUNNER_IGNORED_CHANGED_PATHS = ['.ai-task-runner.lock', 'docs/ai-runner-logs'];
const REQUIRED_TASK_FIELDS = ['id', 'status', 'branch', 'spec', 'plan', 'commit', 'depends_on', 'agent_allowed_paths', 'verify'];
const DEFAULT_CLAUDE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_VERIFY_TIMEOUT_MS = 10 * 60 * 1000;

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
 * verify 只应该做可结束的检查。
 * 这里拦截会改变 git 历史、删除文件或启动长期服务的命令，
 * 避免验证阶段把工作区推进到 Runner 无法推导的状态。
 */
const DISALLOWED_VERIFY_COMMANDS = [
  { pattern: /\bgit\s+(add|commit|push|reset|checkout|switch|merge|rebase)\b/i, reason: 'verify 不能执行 git 变更命令' },
  { pattern: /\brm\s+-rf\b/i, reason: 'verify 不能执行递归删除' },
  { pattern: /\bRemove-Item\b[\s\S]*\b-Recurse\b/i, reason: 'verify 不能执行递归删除' },
  { pattern: /\bdel\s+\/s\b/i, reason: 'verify 不能执行递归删除' },
  { pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve)\b/i, reason: 'verify 不能启动长期运行的开发服务' },
  { pattern: /\b(?:vite|next|nuxt|astro)\s+dev\b/i, reason: 'verify 不能启动长期运行的开发服务' }
];

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

    throw new Error(`未知参数：${arg}`);
  }

  return options;
}

export function createRunnerContext(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());

  return {
    projectRoot,
    taskDir: path.join(projectRoot, 'docs', 'tasks'),
    promptTemplatePath: path.join(projectRoot, 'scripts', 'ai-task-prompt.md'),
    logDir: path.join(projectRoot, 'docs', 'ai-runner-logs'),
    lockFile: path.join(projectRoot, '.ai-task-runner.lock'),
    taskId: options.taskId ? String(options.taskId) : '',
    dryRun: Boolean(options.dryRun),
    claudeTimeoutMs: readTimeoutMs('AI_RUNNER_CLAUDE_TIMEOUT_MS', DEFAULT_CLAUDE_TIMEOUT_MS),
    verifyTimeoutMs: readTimeoutMs('AI_RUNNER_VERIFY_TIMEOUT_MS', DEFAULT_VERIFY_TIMEOUT_MS)
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

  validateTaskSet(context, tasks);
  console.log(`任务队列校验通过：${tasks.length} 个任务。`);

  return tasks;
}

export async function runNextTask(options = {}) {
  const context = resolveContext(options);

  return withRunnerLock(context, async () => {
    ensureGitRepository(context);

    const tasks = loadTasks(context);
    validateTaskSet(context, tasks);
    const task = selectRunnableTask(context, tasks);

    if (!task) {
      console.log('没有 ready 状态且依赖已完成的任务。');
      return false;
    }

    await runTask(context, task, tasks);
    return true;
  });
}

export function resetTaskStatus(options = {}) {
  const context = resolveContext(options);

  if (!context.taskId) {
    throw new Error('恢复任务状态必须传入 --task TASK_ID。');
  }

  const nextStatus = String(options.status || TASK_STATUS.ready);

  if (!Object.values(TASK_STATUS).includes(nextStatus)) {
    throw new Error(`未知任务状态：${nextStatus}`);
  }

  const tasks = loadTasks(context);
  validateTaskSet(context, tasks, { allowRunning: true });
  const task = findTaskById(tasks, context.taskId);

  if (!task) {
    throw new Error(`没有找到任务：${context.taskId}`);
  }

  markTaskStatus(context, task, nextStatus);
  console.log(`任务状态已恢复：${task.meta.id} -> ${nextStatus}`);
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
  markTaskStatus(context, task, TASK_STATUS.running);

  const runningTask = readTask(context, task.filePath);
  const runnerOwnedSnapshots = snapshotRunnerOwnedFiles(context, runningTask);

  try {
    const claudeResult = await runClaudeTask(context, runningTask, logPath);
    const blockedReason = extractBlockedReason(`${claudeResult.stdout}\n${claudeResult.stderr}`);

    if (blockedReason) {
      markTaskStatus(context, runningTask, TASK_STATUS.blocked, blockedReason);
      throw new Error(`任务被标记为 blocked：${blockedReason}`);
    }

    if (claudeResult.exitCode !== 0) {
      throw new Error(`Claude Code 执行失败，退出码：${claudeResult.exitCode}`);
    }

    ensureRunnerOwnedFilesUnchanged(context, runnerOwnedSnapshots);
    ensureTaskChangedSomething(context, runningTask, runnerOwnedSnapshots);
    validateAgentChangedPaths(context, runningTask, runnerOwnedSnapshots);
    await runVerifyCommands(context, runningTask, logPath, runnerOwnedSnapshots);
    validateAgentChangedPaths(context, runningTask, runnerOwnedSnapshots);

    markTaskStatus(context, runningTask, TASK_STATUS.done);
    commitTask(context, readTask(context, task.filePath));

    appendLog(logPath, `任务完成并已提交：${task.meta.id}`);
    console.log(`任务完成并已提交：${task.meta.id}`);
  } catch (error) {
    if (readTask(context, task.filePath).meta.status !== TASK_STATUS.blocked) {
      markTaskStatus(context, runningTask, TASK_STATUS.failed, error.message);
    }

    appendLog(logPath, `任务失败：${error.message}`);
    throw error;
  }
}

function validateTaskSet(context, tasks, options = {}) {
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
  validateAgentAllowedPaths(task);
  validateVerifyCommands(task);
}

function validateTaskDependencies(task, tasks) {
  const dependencies = normalizeArray(task.meta.depends_on);

  for (const dependencyId of dependencies) {
    if (!findTaskById(tasks, dependencyId)) {
      throw new Error(`${task.relativePath} 依赖了不存在的任务：${dependencyId}`);
    }
  }
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

function validateAgentAllowedPaths(task) {
  const allowedPaths = normalizeArray(task.meta.agent_allowed_paths);

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

    if (normalizedPath === task.relativePath || normalizedPath.startsWith('docs/tasks/')) {
      throw new Error(`${task.relativePath} 不能允许 AI 修改 task 状态文件：${rawPath}`);
    }
  }
}

function validateVerifyCommands(task) {
  const verifyCommands = normalizeArray(task.meta.verify);

  if (verifyCommands.length === 0) {
    throw new Error(`${task.relativePath} 缺少 verify 命令。每个 task 必须可验证。`);
  }

  for (const command of verifyCommands) {
    if (!String(command).trim()) {
      throw new Error(`${task.relativePath} 存在空 verify 命令。`);
    }

    for (const rule of DISALLOWED_VERIFY_COMMANDS) {
      if (rule.pattern.test(command)) {
        throw new Error(`${task.relativePath} 的 verify 不合理：${rule.reason}：${command}`);
      }
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

  try {
    writeFileSync(context.lockFile, payload, {
      encoding: 'utf8',
      flag: 'wx'
    });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`检测到已有 Runner 在执行：${context.lockFile}`);
    }

    throw error;
  }

  try {
    return await callback();
  } finally {
    if (existsSync(context.lockFile)) {
      unlinkSync(context.lockFile);
    }
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
  const { command } = createClaudeCommand('');
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

  const allowedPaths = normalizeArray(task.meta.agent_allowed_paths).map(normalizeAllowedPath);
  const blockedFiles = getAgentChangedFiles(context, runnerOwnedSnapshots)
    .filter((filePath) => !isAllowedFile(filePath, allowedPaths));

  if (blockedFiles.length > 0) {
    throw new Error(`检测到超出 agent_allowed_paths 的改动：\n${blockedFiles.join('\n')}`);
  }
}

function getAgentChangedFiles(context, runnerOwnedSnapshots) {
  const runnerOwnedPaths = new Set([...runnerOwnedSnapshots.keys()].map(normalizeAllowedPath));

  return getChangedFiles(context).filter((filePath) => !runnerOwnedPaths.has(normalizeAllowedPath(filePath)));
}

async function runClaudeTask(context, task, logPath) {
  const prompt = buildPrompt(context, task);
  const { command, args } = createClaudeCommand(prompt);

  appendLog(logPath, `启动 Claude Code：${command} -p <task-prompt>`);
  console.log(`启动 Claude Code：${command} -p <task-prompt>`);

  return runCommand(context, command, args, {
    shell: false,
    capture: true,
    timeoutMs: context.claudeTimeoutMs,
    logPath,
    rejectOnFailure: false
  });
}

function createClaudeCommand(prompt) {
  const command = process.env.AI_RUNNER_CLAUDE_BIN || 'claude';
  const args = ['-p', prompt];

  return { command, args };
}

function buildPrompt(context, task) {
  /*
   * 执行 prompt 是 Runner 和 AI 之间的关键契约。
   * 模板缺失时必须直接失败，不能用内置默认内容继续执行，
   * 否则会绕过最新的路径、状态和阻断规则。
   */
  if (!existsSync(context.promptTemplatePath)) {
    throw new Error(`缺少执行 prompt 模板：${toPosix(context.promptTemplatePath)}`);
  }

  const template = readFileSync(context.promptTemplatePath, 'utf8');

  return template
    .replaceAll('{taskId}', String(task.meta.id))
    .replaceAll('{taskTitle}', task.title)
    .replaceAll('{taskPath}', task.relativePath)
    .replaceAll('{specPath}', String(task.meta.spec))
    .replaceAll('{planPath}', String(task.meta.plan))
    .replaceAll('{agentAllowedPaths}', normalizeArray(task.meta.agent_allowed_paths).map((item) => `- ${item}`).join('\n'))
    .replaceAll('{verifyCommands}', normalizeArray(task.meta.verify).map((item) => `- ${item}`).join('\n'));
}

async function runVerifyCommands(context, task, logPath, runnerOwnedSnapshots) {
  const verifyCommands = normalizeArray(task.meta.verify);

  for (const command of verifyCommands) {
    appendLog(logPath, `运行验证命令：${command}`);
    console.log(`运行验证命令：${command}`);

    await runCommand(context, command, [], {
      shell: true,
      capture: true,
      timeoutMs: context.verifyTimeoutMs,
      logPath,
      rejectOnFailure: true
    });

    ensureRunnerOwnedFilesUnchanged(context, runnerOwnedSnapshots);
  }
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

  return uniqueLines(`${unstaged}\n${staged}\n${untracked}`)
    .map(toPosix)
    .filter((filePath) => !isRunnerIgnoredChangedPath(filePath));
}

function isRunnerIgnoredChangedPath(filePath) {
  const normalizedPath = normalizeAllowedPath(filePath);

  return RUNNER_IGNORED_CHANGED_PATHS.some((ignoredPath) => {
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

    if (options.capture) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        appendLog(options.logPath, text.trimEnd());
        process.stdout.write(text);
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

function extractBlockedReason(output) {
  const match = /AI_TASK_BLOCKED:\s*(.+)/.exec(output);
  return match ? match[1].trim() : '';
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

function normalizeAllowedPath(filePath) {
  return toPosix(String(filePath || '')).replace(/^\.?\//, '').replace(/\/+$/, '');
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

function uniqueLines(text) {
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

function toPosix(filePath) {
  return String(filePath).split(path.sep).join('/');
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

function shellQuote(value) {
  /*
   * 非 Windows 环境下用 command -v 检查可执行文件。
   * 这里做最小 shell 转义，避免自定义命令路径中包含空格或引号时破坏检查命令。
   */
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
