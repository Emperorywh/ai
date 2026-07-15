/*
 * GitWorkspace 测试使用独立仓库验证候选指纹、隔离 worktree、归档引用和原子提交。
 * 所有 Git 身份与提交配置都限制在临时目录，不读取或修改用户的真实仓库配置。
 */
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  /*
   * Git 的 tracked diff 默认输出仓库根相对路径，而 ls-files 在子目录中输出项目相对路径。
   * 该用例锁定统一的项目根坐标系，防止 allow 中的 package.json 再次被误判为越界文件。
   */
  it("父仓库子项目按项目根相对路径审计 tracked 与新增文件", async () => {
    const fixture = await createGitFixture();
    const projectRoot = join(fixture.root, "apps", "nested-project");
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "package.json"), "{\"version\":1}\n", "utf8");
    await runGit(fixture.root, ["add", "--all", "--", "."]);
    await runGit(fixture.root, ["commit", "--quiet", "--no-verify", "-m", "添加子项目"]);

    await writeFile(join(projectRoot, "package.json"), "{\"version\":2}\n", "utf8");
    await writeFile(
      join(projectRoot, "src", "feature.ts"),
      "export const enabled = true;\n",
      "utf8",
    );

    const workspace = new GitWorkspace(projectRoot);
    const task: TaskDefinition = {
      ...createTask("TASK-NESTED"),
      scope: {
        allow: ["package.json", "src/**"],
        deny: [],
      },
    };
    const audit = await workspace.auditChanges(task, []);
    const candidate = await workspace.captureCandidate();

    expect(audit).toEqual({
      changedFiles: ["package.json", "src/feature.ts"],
      violations: [],
    });
    expect(candidate.diff).toContain("a/package.json");
    expect(candidate.diff).not.toContain("a/apps/nested-project/package.json");
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

  it("门禁候选在独立 worktree 中变化且只通过显式提升回写", async () => {
    const fixture = await createGitFixture();
    await writeFile(join(fixture.root, ".gitignore"), "dependencies/\n", "utf8");
    await runGit(fixture.root, ["add", "--all", "--", "."]);
    await runGit(fixture.root, ["commit", "--quiet", "--no-verify", "-m", "声明共享依赖"]);
    await mkdir(join(fixture.root, "dependencies"));
    await writeFile(
      join(fixture.root, "dependencies", "runtime.txt"),
      "shared dependency\n",
      "utf8",
    );
    await writeFile(
      join(fixture.root, "feature.ts"),
      "export const version = 1;\n",
      "utf8",
    );
    const candidate = await fixture.workspace.captureCandidate();
    const verification = await fixture.workspace.openVerificationWorkspace({
      runId: "run-isolated-gate",
      taskId: "TASK-ISOLATED",
      sharedPaths: ["dependencies"],
      expectedCandidate: candidate,
    });

    /*
     * 隔离目录中的写入在 promoteCandidate 前不得影响源工作区。
     * 提升后源候选必须与隔离候选指纹完全相同，随后 worktree 可独立释放。
     */
    try {
      await writeFile(
        join(verification.projectRoot, "feature.ts"),
        "export const version = 2;\n",
        "utf8",
      );
      await writeFile(
        join(verification.projectRoot, "generated.ts"),
        "export const generated = true;\n",
        "utf8",
      );
      const isolatedCandidate = await verification.captureCandidate();

      await expect(readFile(
        join(verification.projectRoot, "dependencies", "runtime.txt"),
        "utf8",
      )).resolves.toBe("shared dependency\n");
      await expect(readFile(join(fixture.root, "feature.ts"), "utf8")).resolves.toBe(
        "export const version = 1;\n",
      );
      await expect(access(join(fixture.root, "generated.ts"))).rejects.toMatchObject({
        code: "ENOENT",
      });

      await verification.promoteCandidate(["feature.ts", "generated.ts"]);
      const promoted = await fixture.workspace.captureCandidate();
      expect(promoted.fingerprint).toBe(isolatedCandidate.fingerprint);
    } finally {
      const release = await verification.dispose();
      const repeatedRelease = await verification.dispose();
      expect(release).toEqual({ status: "released", diagnostics: [] });
      expect(repeatedRelease).toEqual(release);
    }

    /*
     * Windows Git 会跟随 worktree 内的目录 junction。释放器必须先解绑自身创建的共享链接，
     * 否则 `git worktree remove --force` 会把源工作区依赖内容一并删除，即使门禁已经通过。
     */
    await expect(readFile(
      join(fixture.root, "dependencies", "runtime.txt"),
      "utf8",
    )).resolves.toBe("shared dependency\n");

    const worktreeList = await runGit(fixture.root, ["worktree", "list", "--porcelain"]);
    expect(worktreeList.match(/^worktree /gmu)).toHaveLength(1);
  });

  it("终态候选归档到持久 Git 引用后清理主工作区", async () => {
    const fixture = await createGitFixture();
    await writeFile(
      join(fixture.root, "README.md"),
      "# 临时仓库\n\n阻塞中的修改。\n",
      "utf8",
    );
    await writeFile(
      join(fixture.root, "feature.ts"),
      "export const blocked = true;\n",
      "utf8",
    );
    await runGit(fixture.root, ["add", "--all", "--", "."]);

    const archive = await fixture.workspace.quarantineCandidate({
      runId: "run-quarantine",
      taskId: "TASK-BLOCKED",
    });

    expect(archive.changedFiles).toEqual(["README.md", "feature.ts"]);
    expect(archive.reference).toMatch(/^refs\/claude-task-orchestrator\/quarantine\//u);
    await expect(fixture.workspace.assertClean()).resolves.toBeUndefined();
    await expect(access(join(fixture.root, "feature.ts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      await runGit(fixture.root, ["show", `${archive.reference}:feature.ts`]),
    ).toBe("export const blocked = true;\n");
    expect(
      await runGit(fixture.root, ["show", `${archive.reference}:README.md`]),
    ).toContain("阻塞中的修改");
    /*
     * 模拟 Git ref 已写入但 RunState 尚未 checkpoint 的崩溃窗口。
     * 第二次归档必须找回原引用和文件清单，不能因为工作区已干净而丢失归档事实。
     */
    const recovered = await fixture.workspace.quarantineCandidate({
      runId: "run-quarantine",
      taskId: "TASK-BLOCKED",
    });
    expect(recovered).toEqual(archive);
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
