/*
 * GitWorkspace 测试使用独立仓库验证候选指纹、归档引用和原子提交。
 * 所有 Git 身份与提交配置都限制在临时目录，不读取或修改用户的真实仓库配置。
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskDefinition } from "../src/domain/project.js";
import { GitWorkspace } from "../src/infrastructure/git/git-workspace.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];
const rootProjectHistoryKey = createHash("sha256").update(".").digest("hex");

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
  const root = await mkdtemp(join(tmpdir(), "apex-coding-agent-git-"));
  temporaryRoots.push(root);

  await runGit(root, ["init", "--quiet"]);
  await runGit(root, ["config", "user.name", "Apex Coding Agent Test"]);
  await runGit(root, [
    "config",
    "user.email",
    "apex-coding-agent@example.invalid",
  ]);
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
 * 任务夹具补齐项目仓储解析后的字段，不附加任何路径或命令能力限制。
 * 提交测试不依赖任务解析器，能够聚焦 GitWorkspace 的项目原子性与 trailer 语义。
 */
function createTask(id: string): TaskDefinition {
  return {
    id,
    title: "实现候选提交",
    file: `orchestration/tasks/${id}.md`,
  };
}

afterEach(async () => {
  const roots = temporaryRoots.splice(0);
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("GitWorkspace", () => {
  it("把运行状态隔离在 Apex Coding Agent 专属 Git 命名空间", async () => {
    const fixture = await createGitFixture();
    const stateDirectory = (
      await fixture.workspace.getStateDirectory()
    ).replaceAll("\\", "/");

    /*
     * 状态目录属于外部持久化契约，必须使用新产品标识且按项目身份继续隔离。
     * 该断言同时确保实现没有回退读取旧产品目录。
     */
    expect(stateDirectory).toMatch(
      /\/\.git\/apex-coding-agent\/[a-f0-9]{16}$/u,
    );
  });

  it("兄弟项目隔离状态目录但共享同一 worktree 锁目录", async () => {
    const fixture = await createGitFixture();
    const firstRoot = join(fixture.root, "apps", "first");
    const secondRoot = join(fixture.root, "apps", "second");
    await Promise.all([
      mkdir(firstRoot, { recursive: true }),
      mkdir(secondRoot, { recursive: true }),
    ]);
    const first = new GitWorkspace(firstRoot);
    const second = new GitWorkspace(secondRoot);

    /*
     * RunState 仍按规范化项目根分区，兄弟项目不会覆盖彼此 checkpoint。
     * 两者共享 HEAD、索引和文件树，所以必须解析到同一 worktree 锁目录。
     */
    await expect(first.getStateDirectory()).resolves.not.toBe(
      await second.getStateDirectory(),
    );
    await expect(first.getLockDirectory()).resolves.toBe(
      await second.getLockDirectory(),
    );
  });

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
   * 该用例锁定统一的项目根坐标系，确保审核文件列表与 diff 使用同一组路径。
   */
  it("父仓库子项目按项目根相对路径捕获 tracked 与新增文件", async () => {
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
    const review = await workspace.captureReviewCandidate();
    const candidate = review.candidate;

    expect(candidate.files.map((file) => file.path)).toEqual([
      "package.json",
      "src/feature.ts",
    ]);
    expect(review.diff).toContain("a/package.json");
    expect(review.diff).not.toContain("a/apps/nested-project/package.json");
  });

  it("识别不改变当前项目树的外部 HEAD 快进", async () => {
    const fixture = await createGitFixture();
    const projectRoot = join(fixture.root, "agv-3d");
    const siblingRoot = join(fixture.root, "china-map-3d");
    await Promise.all([
      mkdir(projectRoot, { recursive: true }),
      mkdir(siblingRoot, { recursive: true }),
    ]);
    await writeFile(join(projectRoot, "package.json"), "{\"version\":1}\n", "utf8");
    await runGit(fixture.root, ["add", "--all", "--", "."]);
    await runGit(fixture.root, [
      "commit",
      "--quiet",
      "--no-verify",
      "-m",
      "添加子项目",
    ]);
    const expectedHead = (await runGit(fixture.root, ["rev-parse", "HEAD"])).trim();
    const workspace = new GitWorkspace(projectRoot);
    await writeFile(join(projectRoot, "package.json"), "{\"version\":2}\n", "utf8");
    const candidateBefore = await workspace.captureCandidate();

    await writeFile(
      join(siblingRoot, "package.json"),
      "{\"name\":\"china-map-3d\"}\n",
      "utf8",
    );
    await runGit(fixture.root, ["add", "--", "china-map-3d"]);
    await runGit(fixture.root, [
      "commit",
      "--quiet",
      "--no-verify",
      "--only",
      "-m",
      "init: china-map-3d",
      "--",
      "china-map-3d",
    ]);
    const currentHead = (await runGit(fixture.root, ["rev-parse", "HEAD"])).trim();

    /*
     * 故障现场的兄弟项目提交只推进祖先链，不改变 agv-3d 端点树或冻结候选。
     * 基础设施返回可验证事实，是否接受该前移仍由应用层统一决定。
     */
    await expect(workspace.inspectHeadAdvance({
      expectedHead,
      currentHead,
    })).resolves.toEqual({
      kind: "descendant",
      changedProjectFiles: [],
    });
    await expect(workspace.captureCandidate()).resolves.toEqual(candidateBefore);
  });

  it("报告外部 HEAD 快进引入的当前项目文件变化", async () => {
    const fixture = await createGitFixture();
    const projectRoot = join(fixture.root, "agv-3d");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "package.json"), "{\"version\":1}\n", "utf8");
    await runGit(fixture.root, ["add", "--all", "--", "."]);
    await runGit(fixture.root, [
      "commit",
      "--quiet",
      "--no-verify",
      "-m",
      "添加子项目",
    ]);
    const expectedHead = (await runGit(fixture.root, ["rev-parse", "HEAD"])).trim();
    await writeFile(join(projectRoot, "package.json"), "{\"version\":2}\n", "utf8");
    await runGit(fixture.root, ["add", "--all", "--", "."]);
    await runGit(fixture.root, [
      "commit",
      "--quiet",
      "--no-verify",
      "-m",
      "修改当前项目",
    ]);
    const currentHead = (await runGit(fixture.root, ["rev-parse", "HEAD"])).trim();
    const workspace = new GitWorkspace(projectRoot);

    await expect(workspace.inspectHeadAdvance({
      expectedHead,
      currentHead,
    })).resolves.toEqual({
      kind: "descendant",
      changedProjectFiles: ["package.json"],
    });
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
        task: createTask("TASK-001"),
        messagePrefix: "task",
        expectedHead: fixture.initialHead,
        expectedFingerprint: candidate.fingerprint,
        taskContractHash: "1".repeat(64),
        predecessorFingerprint: "2".repeat(64),
      }),
    ).rejects.toThrow("候选内容已变化，拒绝提交未经当前审核确认的版本");
    expect((await runGit(fixture.root, ["rev-parse", "HEAD"])).trim()).toBe(
      fixture.initialHead,
    );
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
      taskId: "TASK-001",
    });

    expect(archive.changedFiles).toEqual(["README.md", "feature.ts"]);
    expect(archive.reference).toMatch(
      /^refs\/apex-coding-agent\/quarantine\//u,
    );
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
      taskId: "TASK-001",
    });
    expect(recovered).toEqual(archive);
  });

  it("正常提交写入精确 trailers，并按任务、父提交和候选恢复", async () => {
    const fixture = await createGitFixture();
    const task = createTask("TASK-010");
    const runId = "run-exact-trailers";
    const taskContractHash = "1".repeat(64);
    const predecessorFingerprint = "2".repeat(64);
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
      taskContractHash,
      predecessorFingerprint,
    });
    const commitBody = (
      await runGit(fixture.root, ["show", "-s", "--format=%B", commitSha])
    ).replaceAll("\r\n", "\n").trimEnd();

    expect(commitBody).toBe([
      "task: TASK-010 实现候选提交",
      "",
      `Apex-Coding-Agent-Run: ${runId}`,
      `Apex-Coding-Agent-Project: ${rootProjectHistoryKey}`,
      "Apex-Coding-Agent-Task: TASK-010",
      `Apex-Coding-Agent-Candidate: ${candidate.fingerprint}`,
      `Apex-Coding-Agent-Task-Contract: ${taskContractHash}`,
      `Apex-Coding-Agent-Task-Predecessor: ${predecessorFingerprint}`,
    ].join("\n"));
    /*
     * 完成历史必须从当前 HEAD 的祖先链解析出结构化证据，供新 Run 一次性核验全部 TASK。
     * 自由文本标题不参与匹配，契约和前驱指纹必须来自精确 trailer。
     */
    await expect(
      fixture.workspace.readTaskCompletionHistory(commitSha),
    ).resolves.toEqual([{
      taskId: "TASK-010",
      commitSha,
      runId,
      taskContractHash,
      predecessorFingerprint,
    }]);
    await expect(
      fixture.workspace.findTaskCommit({
        runId,
        taskId: "TASK-010",
        expectedParent: fixture.initialHead,
        candidateFingerprint: candidate.fingerprint,
      }),
    ).resolves.toBe(commitSha);
    await expect(
      fixture.workspace.findTaskCommit({
        runId,
        taskId: "TASK-001",
        expectedParent: fixture.initialHead,
        candidateFingerprint: candidate.fingerprint,
      }),
    ).resolves.toBeUndefined();
    await expect(
      fixture.workspace.findTaskCommit({
        runId,
        taskId: "TASK-010",
        expectedParent: commitSha,
        candidateFingerprint: candidate.fingerprint,
      }),
    ).resolves.toBeUndefined();
    await expect(
      fixture.workspace.findTaskCommit({
        runId,
        taskId: "TASK-010",
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

  it("代码无变化时用空提交保存已通过核验的完成证据", async () => {
    const fixture = await createGitFixture();
    const candidate = await fixture.workspace.captureCandidate();
    const taskContractHash = "3".repeat(64);
    const predecessorFingerprint = "4".repeat(64);

    const commitSha = await fixture.workspace.commitTask({
      runId: "run-empty-completion",
      task: createTask("TASK-011"),
      messagePrefix: "task",
      expectedHead: fixture.initialHead,
      expectedFingerprint: candidate.fingerprint,
      taskContractHash,
      predecessorFingerprint,
    });

    /*
     * 空提交不会出现在带项目 pathspec 的日志中，因此完成历史必须使用项目 trailer 隔离后读取完整祖先链。
     * 该断言同时守护 --fresh 对“现有实现已满足 TASK”的确定性收敛路径。
     */
    expect(commitSha).not.toBe(fixture.initialHead);
    await expect(
      fixture.workspace.readTaskCompletionHistory(commitSha),
    ).resolves.toEqual([{
      taskId: "TASK-011",
      commitSha,
      runId: "run-empty-completion",
      taskContractHash,
      predecessorFingerprint,
    }]);
    await expect(fixture.workspace.assertClean()).resolves.toBeUndefined();
  });
});
