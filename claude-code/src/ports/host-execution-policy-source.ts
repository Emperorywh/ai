/*
 * 宿主执行策略来源只负责提供产品级只读快照。
 * 项目文档、CLI 参数、skill 和 MCP 都不能向该端口注入路径或覆盖字段，
 * 从而保证项目只能引用宿主已经发布的 capability ID。
 */
import type { HostExecutionPolicySnapshot } from "../domain/host-execution-policy.js";

export interface HostExecutionPolicySource {
  load(): Promise<HostExecutionPolicySnapshot>;
}
