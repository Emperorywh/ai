/*
 * SDK 工具边界测试直接执行 PreToolUse hook，不启动真实 Agent 或浏览器。
 * 临时 Git 项目同时覆盖路径范围、受保护文件、忽略规则与符号链接逃逸，确保写入在落盘前失败关闭。
 */
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  HookCallback,
  HookJSONOutput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { createToolBoundaryHooks } from "../src/infrastructure/claude/sdk-tool-boundary.js";
import type { AgentPathBoundary } from "../src/ports/agent-executor.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

interface BoundaryFixture {
  readonly root: string;
  readonly projectRoot: string;
  readonly outsideRoot: string;
  readonly hook: HookCallback;
}

/*
 * 每个夹具都使用真实 Git ignore 语义，但所有文件均隔离在系统临时目录。
 * scope 的职责保持单一：src 下默认允许，deny 与 protected 再做显式收窄。
 */
async function createBoundaryFixture(): Promise<BoundaryFixture> {
  const root = await mkdtemp(join(tmpdir(), "claude-sdk-boundary-"));
  temporaryRoots.push(root);
  const projectRoot = join(root, "project");
  const outsideRoot = join(root, "outside");

  await Promise.all([
    mkdir(join(projectRoot, "src", "denied"), { recursive: true }),
    mkdir(join(projectRoot, "src", "ignored"), { recursive: true }),
    mkdir(outsideRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(projectRoot, ".gitignore"),
      "src/ignored/**\n",
      "utf8",
    ),
    writeFile(
      join(projectRoot, "src", "protected.ts"),
      "export const protectedValue = true;\n",
      "utf8",
    ),
  ]);
  await execFileAsync("git", ["init", "--quiet"], {
    cwd: projectRoot,
    windowsHide: true,
  });

  const policy: AgentPathBoundary = {
    projectRoot,
    write: {
      allow: ["src/**"],
      deny: ["src/denied/**"],
      protectedPaths: ["src/protected.ts"],
    },
  };

  return {
    root,
    projectRoot,
    outsideRoot,
    hook: getPreToolUseHook(policy),
  };
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("createToolBoundaryHooks", () => {
  it("允许 scope 内新文件，并拒绝 protected、deny、项目外与 ignored 路径", async () => {
    const fixture = await createBoundaryFixture();

    const allowed = await invokeWrite(
      fixture.hook,
      fixture.projectRoot,
      "src/new-feature.ts",
    );
    const protectedFile = await invokeWrite(
      fixture.hook,
      fixture.projectRoot,
      "src/protected.ts",
    );
    const denied = await invokeWrite(
      fixture.hook,
      fixture.projectRoot,
      "src/denied/secret.ts",
    );
    const outside = await invokeWrite(
      fixture.hook,
      fixture.projectRoot,
      join(fixture.outsideRoot, "escape.ts"),
    );
    const ignored = await invokeWrite(
      fixture.hook,
      fixture.projectRoot,
      "src/ignored/generated.ts",
    );

    expectPermission(allowed, "allow", "边界内");
    expectPermission(protectedFile, "deny", "受保护文件");
    expectPermission(denied, "deny", "TASK deny");
    expectPermission(outside, "deny", "项目根之外");
    expectPermission(ignored, "deny", "Git ignored");
  });

  it("拒绝通过项目内符号链接写入项目外", async ({ skip }) => {
    const fixture = await createBoundaryFixture();
    const linkPath = join(fixture.projectRoot, "src", "outside-link");

    try {
      await symlink(
        fixture.outsideRoot,
        linkPath,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (isSymlinkPermissionError(error)) {
        skip("当前系统没有创建目录符号链接的权限");
      }
      throw error;
    }

    const output = await invokeWrite(
      fixture.hook,
      fixture.projectRoot,
      "src/outside-link/escape.ts",
    );
    expectPermission(output, "deny", "符号链接逃逸");
  });
});

/*
 * 测试从公开 hooks 契约提取回调，避免访问实现类私有状态。
 * 若组合结构发生不兼容变化，测试会立即失败并指出缺失的 PreToolUse hook。
 */
function getPreToolUseHook(policy: AgentPathBoundary): HookCallback {
  const hook = createToolBoundaryHooks(policy).PreToolUse?.[0]?.hooks[0];
  if (hook === undefined) {
    throw new Error("createToolBoundaryHooks 未注册 PreToolUse hook");
  }
  return hook;
}

async function invokeWrite(
  hook: HookCallback,
  projectRoot: string,
  filePath: string,
): Promise<HookJSONOutput> {
  const input: PreToolUseHookInput = {
    session_id: "11111111-1111-4111-8111-111111111111",
    transcript_path: join(projectRoot, "transcript.jsonl"),
    cwd: projectRoot,
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: filePath, content: "测试内容" },
    tool_use_id: "tool-use-boundary-test",
  };
  return hook(input, input.tool_use_id, {
    signal: new AbortController().signal,
  });
}

function expectPermission(
  output: HookJSONOutput,
  decision: "allow" | "deny",
  reasonFragment: string,
): void {
  if (!("hookSpecificOutput" in output)) {
    throw new Error("PreToolUse hook 未返回同步权限结果");
  }
  const hookOutput = output.hookSpecificOutput;
  if (hookOutput.hookEventName !== "PreToolUse") {
    throw new Error("PreToolUse hook 返回了不匹配的事件结果");
  }

  expect(hookOutput.permissionDecision).toBe(decision);
  expect(hookOutput.permissionDecisionReason).toContain(reasonFragment);
}

function isSymlinkPermissionError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }
  return error.code === "EPERM" || error.code === "EACCES";
}
