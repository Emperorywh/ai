/*
 * GateRunner 执行 Manifest 预先声明的确定性命令，Claude 的自我报告不能替代这些退出码。
 * 命令和参数分开传递，禁止把多个动作拼接为不可审计的 shell 字符串。
 */
import type { GateDefinition } from "../domain/manifest.js";
import type { GateExecutionState } from "../domain/run-state.js";

export interface GateRunner {
  run(
    cwd: string,
    gates: readonly GateDefinition[],
    signal?: AbortSignal,
  ): Promise<readonly GateExecutionState[]>;
}
