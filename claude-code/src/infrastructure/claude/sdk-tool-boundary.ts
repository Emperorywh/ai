/*
 * SDK 工具边界在每次文件工具执行前校验规范化路径、符号链接目标和 TASK 写入范围。
 * 这是实际权限边界而非提示词建议：无法证明位于项目内或命中 allow 的操作会在落盘前被拒绝。
 */
import { lstat, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { promisify } from "node:util";
import type {
  HookCallback,
  Options,
  PreToolUseHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { minimatch } from "minimatch";
import type { AgentPathBoundary } from "../../ports/agent-executor.js";

interface BoundaryDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

const FILE_TOOLS = new Set(["Read", "Edit", "Write"]);
const WRITE_TOOLS = new Set(["Edit", "Write"]);
const execFileAsync = promisify(execFile);
const MAX_PATH_DEPTH = 256;
const GIT_IGNORE_TIMEOUT_MS = 10_000;

export function createToolBoundaryHooks(
  policy: AgentPathBoundary,
): NonNullable<Options["hooks"]> {
  const boundary = new SdkToolBoundary(policy);
  const hook: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const decision = await boundary.evaluate(input);
    return createHookResult(decision);
  };

  return {
    PreToolUse: [{
      matcher: "Read|Glob|Grep|Edit|Write",
      hooks: [hook],
    }],
  };
}

class SdkToolBoundary {
  private readonly lexicalRoot: string;
  private readonly canonicalRoot: Promise<string>;

  public constructor(private readonly policy: AgentPathBoundary) {
    this.lexicalRoot = resolve(policy.projectRoot);
    this.canonicalRoot = realpath(this.lexicalRoot);
  }

  public async evaluate(input: PreToolUseHookInput): Promise<BoundaryDecision> {
    const toolInput = asRecord(input.tool_input);
    if (toolInput === undefined) {
      return this.deny(`${input.tool_name} 输入不是对象`);
    }

    const declaredPaths = this.extractDeclaredPaths(input.tool_name, toolInput);
    if (declaredPaths.error !== undefined) {
      return this.deny(declaredPaths.error);
    }

    for (const value of declaredPaths.paths) {
      const decision = await this.evaluatePath(
        value,
        WRITE_TOOLS.has(input.tool_name),
      );
      if (!decision.allowed) {
        return decision;
      }
    }

    return { allowed: true, reason: "路径位于声明边界内" };
  }

  private extractDeclaredPaths(
    toolName: string,
    input: Readonly<Record<string, unknown>>,
  ): { readonly paths: readonly string[]; readonly error?: string } {
    if (FILE_TOOLS.has(toolName)) {
      const filePath = readString(input, "file_path");
      return filePath === undefined
        ? { paths: [], error: `${toolName} 缺少 file_path` }
        : { paths: [filePath] };
    }

    if (toolName === "Glob") {
      const pattern = readString(input, "pattern");
      if (pattern === undefined || !this.isSafePattern(pattern)) {
        return { paths: [], error: "Glob pattern 包含绝对路径或上级目录" };
      }
      const searchPath = readString(input, "path") ?? ".";
      return { paths: [searchPath] };
    }

    if (toolName === "Grep") {
      const searchPath = readString(input, "path") ?? ".";
      const glob = readString(input, "glob");
      if (glob !== undefined && !this.isSafePattern(glob)) {
        return { paths: [], error: "Grep glob 包含绝对路径或上级目录" };
      }
      return { paths: [searchPath] };
    }

    return { paths: [], error: `未声明文件边界规则的工具：${toolName}` };
  }

  private async evaluatePath(
    declaredPath: string,
    write: boolean,
  ): Promise<BoundaryDecision> {
    const canonicalRoot = await this.canonicalRoot;
    const absoluteTarget = isAbsolute(declaredPath)
      ? resolve(declaredPath)
      : resolve(this.lexicalRoot, declaredPath);
    const lexicalRelative = this.projectRelative(
      absoluteTarget,
      this.lexicalRoot,
      canonicalRoot,
    );
    if (lexicalRelative === undefined) {
      return this.deny(`路径位于项目根之外：${declaredPath}`);
    }

    const canonicalTarget = await this.resolveExistingTarget(absoluteTarget);
    if (!isWithin(canonicalRoot, canonicalTarget)) {
      return this.deny(`路径通过符号链接逃逸项目根：${declaredPath}`);
    }
    const canonicalRelative = normalize(relative(canonicalRoot, canonicalTarget));

    if (write && await this.isIgnoredByGit(absoluteTarget)) {
      return this.deny(`禁止修改 Git ignored 路径：${declaredPath}`);
    }

    for (const candidate of new Set([lexicalRelative, canonicalRelative])) {
      if (candidate === ".git" || candidate.startsWith(".git/")) {
        return this.deny(`禁止访问 Git 内部目录：${declaredPath}`);
      }
      if (write) {
        const writeDecision = this.evaluateWriteScope(candidate, declaredPath);
        if (!writeDecision.allowed) {
          return writeDecision;
        }
      }
    }

    return { allowed: true, reason: "路径位于项目根内" };
  }

  private evaluateWriteScope(
    relativePath: string,
    declaredPath: string,
  ): BoundaryDecision {
    const write = this.policy.write;
    if (write === undefined) {
      return this.deny("只读会话禁止写入工具");
    }
    const protectedPaths = new Set(write.protectedPaths.map(normalize));
    if (protectedPaths.has(relativePath)) {
      return this.deny(`禁止修改受保护文件：${declaredPath}`);
    }
    if (write.deny.some((pattern) => minimatch(relativePath, normalize(pattern), { dot: true }))) {
      return this.deny(`路径命中 TASK deny：${declaredPath}`);
    }
    if (!write.allow.some((pattern) => minimatch(relativePath, normalize(pattern), { dot: true }))) {
      return this.deny(`路径未命中 TASK allow：${declaredPath}`);
    }
    return { allowed: true, reason: "路径命中 TASK allow" };
  }

  private projectRelative(
    target: string,
    lexicalRoot: string,
    canonicalRoot: string,
  ): string | undefined {
    if (isWithin(lexicalRoot, target)) {
      return normalize(relative(lexicalRoot, target));
    }
    if (isWithin(canonicalRoot, target)) {
      return normalize(relative(canonicalRoot, target));
    }
    return undefined;
  }

  private async resolveExistingTarget(target: string): Promise<string> {
    let candidate = target;
    const missingSegments: string[] = [];
    for (let depth = 0; depth < MAX_PATH_DEPTH; depth += 1) {
      try {
        await lstat(candidate);
        return resolve(await realpath(candidate), ...missingSegments);
      } catch (error) {
        if (!isMissingPath(error)) {
          throw error;
        }
        const parent = dirname(candidate);
        if (parent === candidate) {
          throw error;
        }
        missingSegments.unshift(basename(candidate));
        candidate = parent;
      }
    }
    throw new Error(`路径层级过深，无法解析：${target}`);
  }

  private isSafePattern(pattern: string): boolean {
    const normalized = normalize(pattern);
    return !isAbsolute(pattern)
      && normalized !== ".."
      && !normalized.startsWith("../")
      && !normalized.includes("/../");
  }

  private async isIgnoredByGit(path: string): Promise<boolean> {
    try {
      await execFileAsync(
        "git",
        ["check-ignore", "-q", "--no-index", "--", path],
        {
          cwd: this.lexicalRoot,
          windowsHide: true,
          timeout: GIT_IGNORE_TIMEOUT_MS,
        },
      );
      return true;
    } catch (error) {
      if (isExitCode(error, 1)) {
        return false;
      }
      throw error;
    }
  }

  private deny(reason: string): BoundaryDecision {
    return { allowed: false, reason };
  }
}

function createHookResult(decision: BoundaryDecision): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision.allowed ? "allow" : "deny",
      permissionDecisionReason: decision.reason,
    },
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function readString(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isWithin(root: string, target: string): boolean {
  const value = relative(root, target);
  return value === "" || (
    value !== ".."
    && !value.startsWith(`..\\`)
    && !value.startsWith("../")
    && !isAbsolute(value)
  );
}

function normalize(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  return normalized.length === 0 ? "." : normalized;
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isExitCode(error: unknown, code: number): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
