/*
 * WorkspaceBaselineResolver 集中解释 Run 快照与当前 Git 身份的关系。
 * 它只组合仓库身份和历史事实，不修改 RunState，也不决定调用方应使用哪类错误语义。
 */
import type { RunWorkspaceState } from "../domain/run-state.js";
import type {
  WorkspaceHistoryInspector,
  WorkspaceIdentityStore,
} from "../ports/workspace.js";

export type WorkspaceBaselineResolution =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "safe_advance";
      readonly currentHead: string;
    }
  | {
      readonly kind: "repository_changed";
      readonly currentRepositoryRoot: string;
    }
  | {
      readonly kind: "branch_changed";
      readonly currentBranch: string;
    }
  | {
      readonly kind: "head_conflict";
      readonly currentHead: string;
      readonly changedProjectFiles: readonly string[];
    };

export class WorkspaceBaselineResolver {
  public constructor(
    private readonly workspace: WorkspaceIdentityStore
      & WorkspaceHistoryInspector,
  ) {}

  public async resolve(
    expected: RunWorkspaceState,
  ): Promise<WorkspaceBaselineResolution> {
    const current = await this.workspace.getIdentity();
    if (current.repositoryRoot !== expected.repositoryRoot) {
      return {
        kind: "repository_changed",
        currentRepositoryRoot: current.repositoryRoot,
      };
    }
    if (current.branch !== expected.branch) {
      return { kind: "branch_changed", currentBranch: current.branch };
    }
    if (current.head === expected.expectedHead) {
      return { kind: "unchanged" };
    }

    const advance = await this.workspace.inspectHeadAdvance({
      expectedHead: expected.expectedHead,
      currentHead: current.head,
    });
    if (
      advance.kind === "descendant"
      && advance.changedProjectFiles.length === 0
    ) {
      /*
       * 仅接受祖先链向前且当前项目端点树完全一致的变化。
       * 这覆盖兄弟项目提交，同时拒绝回退、分叉和任何会使审核基线失真的项目内变化。
       */
      return { kind: "safe_advance", currentHead: current.head };
    }
    return {
      kind: "head_conflict",
      currentHead: current.head,
      changedProjectFiles: advance.kind === "descendant"
        ? advance.changedProjectFiles
        : [],
    };
  }
}
