#!/usr/bin/env node
/*
 * PreToolUse 钩子：在 Claude 调用 Edit/Write/MultiEdit/NotebookEdit 之前，
 * 检查目标路径是否在当前 task 的 agent_allowed_paths 内。
 * 越界时以退出码 2 阻断本次编辑，stderr 反馈给 Claude，让它自行改用允许范围内的路径。
 *
 * 这是 agent_allowed_paths 的“事前”防线，让边界从“事后 git diff 报错”
 * 升级为“工具调用层不可逾越”。Runner 的事后校验仍作为二道防线保留。
 *
 * 触发依赖：Runner 启动 Claude 时通过环境变量 AI_RUNNER_TASK_CONTEXT 指向一个
 * 上下文 JSON（含 allowlist、受保护模式、项目根）。没有该变量时直接放行，
 * 不影响交互式或未托管的使用场景。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const GATED_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function toPosix(filePath) {
  return String(filePath).split(path.sep).join('/');
}

function normalizePath(filePath) {
  return toPosix(String(filePath || '')).replace(/^\.?\//, '').replace(/\/+$/, '');
}

function isInsideRoot(root, targetPath) {
  const relativePath = path.relative(path.resolve(root), path.resolve(targetPath));
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

/*
 * Claude 可能传入相对或绝对路径，统一解析成项目内 posix 相对路径。
 * 项目外的路径直接判为越界。
 */
function resolveRelativeToProject(projectRoot, filePath) {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(projectRoot, filePath);

  if (!isInsideRoot(projectRoot, absolutePath)) {
    return null;
  }

  return normalizePath(path.relative(projectRoot, absolutePath));
}

/*
 * 与 task-lib 保持一致的最小 glob 语义：
 * 单星号匹配一个路径片段，双星号跨目录。
 */
function pathPatternToRegExp(pattern) {
  const normalizedPattern = normalizePath(pattern);
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '__AI_RUNNER_DOUBLE_STAR__')
    .replaceAll('*', '[^/]*')
    .replaceAll('__AI_RUNNER_DOUBLE_STAR__', '.*');

  return new RegExp(`^${escaped}$`);
}

function isWithinAllowed(filePath, allowedPaths) {
  return allowedPaths.some((allowedPath) => {
    if (!allowedPath) {
      return false;
    }

    return filePath === allowedPath || filePath.startsWith(`${allowedPath}/`);
  });
}

function matchesAnyPattern(filePath, patterns) {
  return patterns.some((pattern) => pathPatternToRegExp(pattern).test(filePath));
}

function isProtectedFile(filePath, protectedFiles) {
  return protectedFiles.some((protectedFile) => {
    return filePath === protectedFile || filePath.startsWith(`${protectedFile}/`);
  });
}

function loadContext() {
  const contextPath = process.env.AI_RUNNER_TASK_CONTEXT;

  if (!contextPath) {
    return null;
  }

  let context;

  try {
    context = JSON.parse(readFileSync(contextPath, 'utf8'));
  } catch {
    return null;
  }

  /*
   * Runner 写入前已归一化，但 hook 作为独立防线也自行归一化一次，
   * 避免尾斜杠、反斜杠或 ./ 前缀导致 isWithinAllowed 拼出 'src/a//' 永远不匹配。
   */
  context.allowedPaths = normalizeArray(context.allowedPaths).map(normalizePath);
  context.protectedFiles = normalizeArray(context.protectedFiles).map(normalizePath);
  context.forbiddenPatterns = normalizeArray(context.forbiddenPatterns).map(normalizePath);

  return context;
}

function normalizeArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function extractTargetPaths(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') {
    return [];
  }

  const paths = [];

  if (typeof toolInput.file_path === 'string') {
    paths.push(toolInput.file_path);
  }

  if (typeof toolInput.notebook_path === 'string') {
    paths.push(toolInput.notebook_path);
  }

  return paths;
}

function main() {
  let payload;

  try {
    payload = JSON.parse(readStdin());
  } catch {
    return; // 无法解析事件，放行，交给事后校验兜底
  }

  const toolName = String(payload.tool_name || '');

  if (!GATED_TOOLS.has(toolName)) {
    return; // 只拦截文件编辑类工具
  }

  const context = loadContext();

  if (!context) {
    return; // 没有托管上下文（如交互式使用），放行
  }

  const projectRoot = context.projectRoot || process.cwd();
  const targetPaths = extractTargetPaths(payload.tool_input);
  const violations = [];

  for (const rawPath of targetPaths) {
    const relativePath = resolveRelativeToProject(projectRoot, rawPath);

    if (relativePath === null) {
      violations.push(`${rawPath}（位于项目之外）`);
      continue;
    }

    if (isProtectedFile(relativePath, context.protectedFiles || [])) {
      violations.push(`${relativePath}（受保护的 SPEC/PLAN/task 文件）`);
      continue;
    }

    if (matchesAnyPattern(relativePath, context.forbiddenPatterns || [])) {
      violations.push(`${relativePath}（命中受保护路径模式）`);
      continue;
    }

    if (!isWithinAllowed(relativePath, context.allowedPaths || [])) {
      violations.push(`${relativePath}（不在 agent_allowed_paths 内）`);
      continue;
    }
  }

  if (violations.length > 0) {
    const reason = violations.map((item) => `- ${item}`).join('\n');
    console.error(`AI Task Runner 路径闸门拦截：以下编辑超出 task 边界，已被拒绝：\n${reason}`);
    process.exit(2);
  }
}

main();
