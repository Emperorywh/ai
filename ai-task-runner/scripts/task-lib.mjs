import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TASK_DIR = path.join(process.cwd(), 'docs', 'tasks');
const PROMPT_TEMPLATE_PATH = path.join(process.cwd(), 'scripts', 'ai-task-prompt.md');

/*
 * 这里集中定义任务状态，避免状态字符串散落在多个脚本中。
 * Runner 只识别这些状态，后续要扩展 review、merged 等阶段时，
 * 应该先在这里补充，再让其它模块显式依赖。
 */
const TASK_STATUS = {
  pending: 'pending',
  running: 'running',
  done: 'done',
  failed: 'failed',
  blocked: 'blocked'
};

/*
 * Claude Code 的 CLI 参数未来可能继续演进，所以这里做成单独函数。
 * 默认使用最小稳定入口：claude -p <prompt>。
 * 如果你的本地 CLI 需要额外参数，可以通过 AI_RUNNER_CLAUDE_BIN 替换命令，
 * 或直接在这里增加 --output-format、--max-turns、--allowedTools 等参数。
 */
function createClaudeCommand(prompt) {
  const command = process.env.AI_RUNNER_CLAUDE_BIN || 'claude';
  const args = ['-p', prompt];

  return { command, args };
}

export function loadTasks() {
  if (!existsSync(TASK_DIR)) {
    return [];
  }

  return readdirSync(TASK_DIR)
    .filter((fileName) => fileName.endsWith('.md'))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => readTask(path.join(TASK_DIR, fileName)));
}

export function printTaskStatus(tasks) {
  if (tasks.length === 0) {
    console.log('没有找到 docs/tasks/*.md 任务文件。');
    return;
  }

  const rows = tasks.map((task) => ({
    id: String(task.meta.id || task.fileName),
    status: String(task.meta.status || 'unknown'),
    branch: String(task.meta.branch || defaultBranchName(task)),
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

export async function runNextTask() {
  ensureGitRepository();

  const tasks = loadTasks();
  const task = tasks.find((item) => item.meta.status === TASK_STATUS.pending);

  if (!task) {
    console.log('没有 pending 状态的任务。');
    return false;
  }

  await runTask(task);
  return true;
}

async function runTask(task) {
  ensureCleanWorkingTree();
  ensureTaskHasVerifyCommands(task);
  ensureGitCommitIdentity();
  ensureClaudeAvailable();

  const branch = String(task.meta.branch || defaultBranchName(task));
  console.log(`准备执行 ${task.meta.id || task.fileName}：${task.title}`);
  ensureBranch(branch);

  markTaskStatus(task, TASK_STATUS.running);

  try {
    const runningTask = readTask(task.filePath);
    const claudeOutput = await runClaudeTask(runningTask);
    const blockedReason = extractBlockedReason(claudeOutput);

    if (blockedReason) {
      markTaskStatus(runningTask, TASK_STATUS.blocked, blockedReason);
      throw new Error(`任务被标记为 blocked：${blockedReason}`);
    }

    ensureTaskChangedSomething(runningTask);
    validateAllowedPaths(runningTask);
    await runVerifyCommands(runningTask);
    validateAllowedPaths(runningTask);

    const doneTask = readTask(task.filePath);
    markTaskStatus(doneTask, TASK_STATUS.done);
    validateAllowedPaths(readTask(task.filePath));
    commitTask(readTask(task.filePath));

    console.log(`任务完成并已提交：${task.meta.id || task.fileName}`);
  } catch (error) {
    const latestTask = readTask(task.filePath);

    if (latestTask.meta.status !== TASK_STATUS.blocked) {
      markTaskStatus(latestTask, TASK_STATUS.failed, error.message);
    }

    throw error;
  }
}

function readTask(filePath) {
  const markdown = readFileSync(filePath, 'utf8');
  const parsed = parseFrontmatter(markdown);
  const relativePath = toPosix(path.relative(process.cwd(), filePath));

  return {
    filePath,
    relativePath,
    fileName: path.basename(filePath),
    meta: parsed.meta,
    body: parsed.body,
    title: extractTitle(parsed.body)
  };
}

function parseFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);

  if (!match) {
    throw new Error('任务文件必须包含 YAML frontmatter。');
  }

  return {
    meta: parseSimpleYaml(match[1]),
    body: match[2]
  };
}

function parseSimpleYaml(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const meta = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    const fieldMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);

    if (!fieldMatch) {
      continue;
    }

    const key = fieldMatch[1];
    const value = fieldMatch[2];

    if (value === '') {
      const items = [];

      while (index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1])) {
        index += 1;
        items.push(parseScalar(lines[index].replace(/^\s+-\s+/, '')));
      }

      meta[key] = items;
    } else {
      meta[key] = parseScalar(value);
    }
  }

  return meta;
}

function parseScalar(value) {
  const trimmed = value.trim();

  if (trimmed === 'true') {
    return true;
  }

  if (trimmed === 'false') {
    return false;
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

function stringifyFrontmatter(meta, body) {
  const preferredOrder = [
    'id',
    'status',
    'branch',
    'spec',
    'plan',
    'commit',
    'allowed_paths',
    'verify',
    'allow_empty_code_changes',
    'updated_at',
    'last_error'
  ];
  const keys = [
    ...preferredOrder.filter((key) => Object.prototype.hasOwnProperty.call(meta, key)),
    ...Object.keys(meta).filter((key) => !preferredOrder.includes(key))
  ];
  const lines = ['---'];

  for (const key of keys) {
    const value = meta[key];

    if (Array.isArray(value)) {
      lines.push(`${key}:`);

      for (const item of value) {
        lines.push(`  - ${formatScalar(item)}`);
      }
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
  }

  lines.push('---');
  lines.push(body.replace(/^\r?\n/, ''));

  return `${lines.join('\n')}`;
}

function formatScalar(value) {
  const text = String(value ?? '');

  if (!text || /[:#\[\]{}\n\r]|^\s|\s$/.test(text)) {
    return JSON.stringify(text);
  }

  return text;
}

function markTaskStatus(task, status, reason = '') {
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

function ensureGitRepository() {
  runGit(['rev-parse', '--is-inside-work-tree'], { capture: true });
}

function ensureCleanWorkingTree() {
  const changedFiles = getChangedFiles();

  if (changedFiles.length > 0) {
    throw new Error(`工作区不干净，请先处理这些文件：\n${changedFiles.join('\n')}`);
  }
}

function ensureBranch(branch) {
  const currentBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true }).trim();

  if (currentBranch === branch) {
    return;
  }

  const branches = runGit(['branch', '--list', branch], { capture: true }).trim();

  if (branches) {
    runGit(['switch', branch]);
  } else {
    runGit(['switch', '-c', branch]);
  }
}

function ensureTaskHasVerifyCommands(task) {
  const verifyCommands = normalizeArray(task.meta.verify);

  if (verifyCommands.length === 0) {
    throw new Error(`${task.relativePath} 缺少 verify 命令。每个 task 必须可验证。`);
  }
}

function ensureGitCommitIdentity() {
  const userName = readGitConfig('user.name');
  const userEmail = readGitConfig('user.email');

  if (!userName || !userEmail) {
    throw new Error('git 缺少 user.name 或 user.email，runner 无法自动提交。');
  }
}

function ensureClaudeAvailable() {
  const { command } = createClaudeCommand('');
  const checker = process.platform === 'win32'
    ? { command: 'where', args: [command], shell: false }
    : { command: 'sh', args: ['-lc', `command -v ${shellQuote(command)}`], shell: false };
  const result = spawnSync(checker.command, checker.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: checker.shell
  });

  if (result.status !== 0) {
    throw new Error(`没有找到 Claude Code 命令：${command}`);
  }
}

function readGitConfig(key) {
  const result = spawnSync('git', ['config', '--get', key], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false
  });

  return result.status === 0 ? result.stdout.trim() : '';
}

function ensureTaskChangedSomething(task) {
  if (task.meta.allow_empty_code_changes === true) {
    return;
  }

  const changedFiles = getChangedFiles().filter((filePath) => filePath !== task.relativePath);

  if (changedFiles.length === 0) {
    throw new Error('Claude 没有产生当前任务文件之外的改动，任务不会被自动提交。');
  }
}

function validateAllowedPaths(task) {
  const allowedPaths = [
    task.relativePath,
    ...normalizeArray(task.meta.allowed_paths)
  ].map(normalizeAllowedPath);
  const changedFiles = getChangedFiles();
  const blockedFiles = changedFiles.filter((filePath) => !isAllowedFile(filePath, allowedPaths));

  if (blockedFiles.length > 0) {
    throw new Error(`检测到超出 allowed_paths 的改动：\n${blockedFiles.join('\n')}`);
  }
}

function normalizeAllowedPath(filePath) {
  return toPosix(filePath).replace(/^\.?\//, '').replace(/\/+$/, '');
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

async function runClaudeTask(task) {
  const prompt = buildPrompt(task);
  const { command, args } = createClaudeCommand(prompt);

  console.log(`启动 Claude Code：${command} -p <task-prompt>`);
  return runCommand(command, args, { shell: false, capture: true });
}

function buildPrompt(task) {
  const template = existsSync(PROMPT_TEMPLATE_PATH)
    ? readFileSync(PROMPT_TEMPLATE_PATH, 'utf8')
    : defaultPromptTemplate();

  return template
    .replaceAll('{taskId}', String(task.meta.id || task.fileName))
    .replaceAll('{taskTitle}', task.title)
    .replaceAll('{taskPath}', task.relativePath)
    .replaceAll('{specPath}', String(task.meta.spec || 'docs/SPEC_xxxx.md'))
    .replaceAll('{planPath}', String(task.meta.plan || 'docs/PLAN_xxxx.md'))
    .replaceAll('{allowedPaths}', normalizeArray(task.meta.allowed_paths).map((item) => `- ${item}`).join('\n'))
    .replaceAll('{verifyCommands}', normalizeArray(task.meta.verify).map((item) => `- ${item}`).join('\n'));
}

function defaultPromptTemplate() {
  return [
    '你正在执行一个独立 AI coding task。',
    '',
    '任务：{taskId} - {taskTitle}',
    '任务文件：{taskPath}',
    '规格文件：{specPath}',
    '计划文件：{planPath}',
    '',
    '你必须先阅读 AGENTS.md、规格文件、计划文件和当前任务文件。',
    '只实现当前任务，不实现后续任务。',
    '不要修改 task 状态，不要提交 git commit。',
    '如果无法继续，请在最后单独输出：AI_TASK_BLOCKED: 原因。',
    '',
    '允许修改路径：',
    '{allowedPaths}',
    '',
    '验证命令：',
    '{verifyCommands}'
  ].join('\n');
}

async function runVerifyCommands(task) {
  const verifyCommands = normalizeArray(task.meta.verify);

  for (const command of verifyCommands) {
    console.log(`运行验证命令：${command}`);
    await runCommand(command, [], { shell: true, capture: false });
  }
}

function commitTask(task) {
  const changedFiles = getChangedFiles();

  if (changedFiles.length === 0) {
    throw new Error('没有可提交的改动。');
  }

  runGit(['add', '--all', '--', ...changedFiles]);
  runGit(['commit', '-m', String(task.meta.commit || defaultCommitMessage(task))]);
}

function defaultCommitMessage(task) {
  const id = String(task.meta.id || path.basename(task.fileName, '.md'));
  return `feat(${id}): ${task.title}`;
}

function getChangedFiles() {
  const unstaged = runGit(['diff', '--name-only'], { capture: true });
  const staged = runGit(['diff', '--name-only', '--cached'], { capture: true });
  const untracked = runGit(['ls-files', '--others', '--exclude-standard'], { capture: true });

  return uniqueLines(`${unstaged}\n${staged}\n${untracked}`).map(toPosix);
}

function runGit(args, options = {}) {
  return runCommandSync('git', args, options);
}

function runCommandSync(command, args, options = {}) {
  const result = spawnSyncCompat(command, args, options);

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} ${args.join(' ')} 执行失败`);
  }

  return result.stdout;
}

function spawnSyncCompat(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: options.shell || false
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: options.shell || false,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });

    let stdout = '';
    let stderr = '';

    if (options.capture) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        process.stdout.write(text);
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        process.stderr.write(text);
      });
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || stdout || `${command} 执行失败，退出码：${code}`));
      }
    });
  });
}

function extractBlockedReason(output) {
  const match = /AI_TASK_BLOCKED:\s*(.+)/.exec(output);
  return match ? match[1].trim() : '';
}

function extractTitle(body) {
  const heading = body.split(/\r?\n/).find((line) => line.startsWith('# '));
  return heading ? heading.replace(/^#\s+/, '').trim() : '未命名任务';
}

function defaultBranchName(task) {
  const id = String(task.meta.id || path.basename(task.fileName, '.md')).toLowerCase();
  return `ai/${id}`;
}

function normalizeArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function uniqueLines(text) {
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function shellQuote(value) {
  /*
   * 非 Windows 环境下用 command -v 检查可执行文件。
   * 这里做最小 shell 转义，避免自定义命令路径中包含空格或引号时破坏检查命令。
   */
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
