/*
 * GitTaskCompletionLedger 只解释当前 HEAD 可达的精确 trailer 完成事实。
 * 它不读取候选文件、不修改工作区，应用层负责将历史证据核验为连续任务前缀。
 */
import { PRODUCT_IDENTITY } from "../../product-identity.js";
import type { TaskCompletionEvidence } from "../../ports/workspace.js";
import type { GitCommandRunner } from "./git-command-runner.js";
import type { GitProjectBoundary } from "./git-project-boundary.js";

export class GitTaskCompletionLedger {
  public constructor(
    private readonly git: GitCommandRunner,
    private readonly boundary: GitProjectBoundary,
  ) {}

  public async findTaskCommit(input: {
    runId: string;
    taskId: string;
    expectedParent: string;
    candidateFingerprint: string;
  }): Promise<string | undefined> {
    const head = (await this.git.run(["rev-parse", "HEAD"])).trim();
    const body = await this.git.run(["log", "-1", "--format=%B", "HEAD"]);
    const trailers = parseExactTrailers(body);
    const projectHistoryKey = await this.boundary.getProjectHistoryKey();
    const matches = trailers.get(PRODUCT_IDENTITY.gitTrailers.run) === input.runId
      && trailers.get(PRODUCT_IDENTITY.gitTrailers.project) === projectHistoryKey
      && trailers.get(PRODUCT_IDENTITY.gitTrailers.task) === input.taskId
      && trailers.get(PRODUCT_IDENTITY.gitTrailers.candidate)
        === input.candidateFingerprint;
    if (!matches) {
      return undefined;
    }
    const parent = (await this.git.run(["rev-parse", `${head}^`])).trim();
    return parent === input.expectedParent ? head : undefined;
  }

  public async readHistory(
    head: string,
  ): Promise<readonly TaskCompletionEvidence[]> {
    const projectHistoryKey = await this.boundary.getProjectHistoryKey();
    const history = await this.git.run([
      "log",
      "--format=%H%x00%B%x00",
      "--fixed-strings",
      `--grep=${PRODUCT_IDENTITY.gitTrailers.project}: ${projectHistoryKey}`,
      head,
    ]);
    const fields = history.split("\0");
    const evidence: TaskCompletionEvidence[] = [];
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const commitSha = fields[index]?.trim();
      const body = fields[index + 1];
      if (commitSha === undefined || commitSha.length === 0 || body === undefined) {
        continue;
      }
      const trailers = parseExactTrailers(body);
      const taskId = trailers.get(PRODUCT_IDENTITY.gitTrailers.task);
      const runId = trailers.get(PRODUCT_IDENTITY.gitTrailers.run);
      const project = trailers.get(PRODUCT_IDENTITY.gitTrailers.project);
      const taskContractHash = trailers.get(
        PRODUCT_IDENTITY.gitTrailers.taskContract,
      );
      const predecessorFingerprint = trailers.get(
        PRODUCT_IDENTITY.gitTrailers.taskPredecessor,
      );
      if (
        taskId !== undefined
        && runId !== undefined
        && project === projectHistoryKey
        && taskContractHash !== undefined
        && predecessorFingerprint !== undefined
      ) {
        evidence.push({
          taskId,
          commitSha,
          runId,
          taskContractHash,
          predecessorFingerprint,
        });
      }
    }
    return evidence;
  }
}

/*
 * 完成证据只接受恰好出现一次的精确 trailer；重复键被视为歧义并拒绝复用。
 * 解析器不依赖提交标题或自由文本，任务名包含相似前缀时不会发生误匹配。
 */
function parseExactTrailers(body: string): ReadonlyMap<string, string> {
  const values = new Map<string, string[]>();
  const knownKeys = Object.values(PRODUCT_IDENTITY.gitTrailers);
  for (const line of body.split(/\r?\n/u)) {
    const normalizedLine = line.trim();
    const key = knownKeys.find((candidate) =>
      normalizedLine.startsWith(`${candidate}:`));
    if (key === undefined) {
      continue;
    }
    const value = normalizedLine.slice(key.length + 1).trim();
    if (value.length === 0) {
      continue;
    }
    const existing = values.get(key) ?? [];
    existing.push(value);
    values.set(key, existing);
  }
  return new Map(
    [...values.entries()]
      .filter(([, entries]) => entries.length === 1)
      .map(([key, entries]) => [key, entries[0] as string]),
  );
}
