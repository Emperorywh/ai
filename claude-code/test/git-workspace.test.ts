/*
 * GitWorkspace 测试使用独立本地仓库验证候选指纹、提交原子性和恢复 trailer 协议。
 * 所有 Git 身份与提交配置都限制在临时目录，不读取或修改用户的真实仓库配置。
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskDefinition } from "../src/domain/manifest.js";
import { GitWorkspace } from "../src/infrastructure/git/git-workspace.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

interface GitFixture {
  readonly root: string;
  readonly initialHead: string;
  readonly workspace: GitWorkspace;
}

/**
 * Git 命令始终以参数数组调用，测试不会通过 shell 拼接动态文本。
 * 返回值统一保留 Git 原始正文，由具体断言决定是否裁剪换行。
 */
async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return stdout;
}

/**
 * 每个用例创建包含一个初始提交的独立仓库，HEAD 因而可以作为候选提交的精确父提交。
 * 仓库级用户身份与签名配置避免测试依赖开发机器的全局 Git 设置。
 */
async function createGitFixture(): Promise<GitFixture> {
  const root = await mkdtemp(join(tmpdir(), "claude-git-workspace-"));
  temporaryRoots.push(root);

  await runGit(root, ["init", "--quiet"]);
  await runGit(root, ["config", "user.name", "Orchestrator Test"]);
  await runGit(root, ["config", "user.email", "orchestrator@example.invalid"]);
  await runGit(root, ["config", "commit.gpgSign", "false"]);
  await writeFile(join(root, "README.md"), "# 临时仓库\n", "utf8");
  await runGit(root, ["add", "--all", "--", "."]);
  await runGit(root, ["commit", "--quiet", "--no-verify", "-m", "初始提交"]);

  return {
    root,
    initialHead: (await runGit(root, ["rev-parse", "HEAD"])).trim(),
    workspace: new GitWorkspace(root),
  };
}

/**
 * 任务夹具补齐 Manifest 解析后的字段，只开放临时仓库中的 TypeScript 文件。
 * 提交测试不依赖任务解析器，能够聚焦 GitWorkspace 的边界与 trailer 语义。
 */
function createTask(id: string): TaskDefinition {
  return {
    id,
    title: "实现候选提交",
    file: `tasks/${id}.md`,
    dependsOn: [],
    scope: {
      allow: ["*.ts"],
      deny: [],
    },
    gates: [
      {
        name: "类型检查",
        command: "pnpm",
        args: ["run", "typecheck"],
        timeoutMinutes: 15,
      },
    ],
    manualAcceptance: [],
  };
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("GitWorkspace", () => {
  it("候选内容在加入暂存区前后保持相同 fingerprint", async () => {
    const fixture = await createGitFixture();
    await writeFile(
      join(fixture.root, "README.md"),
      "# 临时仓库\n\n已修改。\n",
      "utf8",
    );
    await writeFile(
      join(fixture.root, "feature.ts"),
      "export const enabled = true;\n",
      "utf8",
    );

    const beforeStaging = await fixture.workspace.captureCandidate();
    await runGit(fixture.root, ["add", "--all", "--", "."]);
    const afterStaging = await fixture.workspace.captureCandidate();

    expect(afterStaging.fingerprint).toBe(beforeStaging.fingerprint);
  });

  it("expected fingerprint 对应的候选发生变化时拒绝提交", async () => {
    const fixture = await createGitFixture();
    await writeFile(
      join(fixture.root, "feature.ts"),
      "export const version = 1;\n",
      "utf8",
    );
    const candidate = await fixture.workspace.captureCandidate();

    await writeFile(
      join(fixture.root, "feature.ts"),
      "export const version = 2;\n",
      "utf8",
    );

    await expect(
      fixture.workspace.commitTask({
        runId: "run-fingerprint",
        task: createTask("TASK-1"),
        messagePrefix: "task",
        expectedHead: fixture.initialHead,
        expectedFingerprint: candidate.fingerprint,
      }),
    ).rejects.toThrow("候选内容已变化，拒绝提交未经当前门禁和审核的版本");
    expect((await runGit(fixture.root, ["rev-parse", "HEAD"])).trim()).toBe(
      fixture.initialHead,
    );
  });

  it("正常提交写入精确 trailers，并按任务、父提交和候选恢复", async () => {
    const fixture = await createGitFixture();
    const task = createTask("TASK-10");
    const runId = "run-exact-trailers";
    await writeFile(
      join(fixture.root, "feature.ts"),
      "export const completed = true;\n",
      "utf8",
    );
    const candidate = await fixture.workspace.captureCandidate();

    const commitSha = await fixture.workspace.commitTask({
      runId,
      task,
      messagePrefix: "task",
      expectedHead: fixture.initialHead,
      expectedFingerprint: candidate.fingerprint,
    });
    const commitBody = (
      await runGit(fixture.root, ["show", "-s", "--format=%B", commitSha])
    ).replaceAll("\r\n", "\n").trimEnd();

    expect(commitBody).toBe([
      "task: TASK-10 实现候选提交",
      "",
      `Orchestrator-Run: ${runId}`,
      "Orchestrator-Task: TASK-10",
      `Orchestrator-Candidate: ${candidate.fingerprint}`,
    ].join("\n"));
    await expect(
      fixture.workspace.findTaskCommit({
        runId,
        taskId: "TASK-10",
        expectedParent: fixture.initialHead,
        candidateFingerprint: candidate.fingerprint,
      }),
    ).resolves.toBe(commitSha);
    await expect(
      fixture.workspace.findTaskCommit({
        runId,
        taskId: "TASK-1",
        expectedParent: fixture.initialHead,
        candidateFingerprint: candidate.fingerprint,
      }),
    ).resolves.toBeUndefined();
    await expect(
      fixture.workspace.findTaskCommit({
        runId,
        taskId: "TASK-10",
        expectedParent: commitSha,
        candidateFingerprint: candidate.fingerprint,
      }),
    ).resolves.toBeUndefined();
    await expect(
      fixture.workspace.findTaskCommit({
        runId,
        taskId: "TASK-10",
        expectedParent: fixture.initialHead,
        candidateFingerprint: "0".repeat(64),
      }),
    ).resolves.toBeUndefined();
    await expect(fixture.workspace.assertClean()).resolves.toBeUndefined();
    expect(
      await runGit(fixture.root, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]),
    ).toBe("");
  });
});
