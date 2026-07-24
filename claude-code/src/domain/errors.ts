/*
 * 领域错误只表达稳定的业务语义，不携带 SDK、文件系统或进程实现细节。
 * CLI 可据此选择退出码，应用服务也能明确区分配置错误、阻塞和基础设施故障。
 */
export class ConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class StateTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StateTransitionError";
  }
}

export class InfrastructureError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InfrastructureError";
  }
}

export class RunLockedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RunLockedError";
  }
}

/*
 * CanonicalViolationError 是唯一规范编码边界的 fail-closed 拒绝信号。
 * 未知字段、非规范文本、非法 Unicode、非有限数字和非法路径都通过它拒绝，不允许清洗后继续。
 */
export class CanonicalViolationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CanonicalViolationError";
  }
}

/*
 * CandidateChangedError 表达冻结候选与当前文件树不一致的稳定业务语义。
 * 应用层可将其收敛为 blocked，其他 Git 或文件系统故障仍按基础设施错误传播。
 */
export class CandidateChangedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CandidateChangedError";
  }
}

/*
 * 内容寻址证据存储的错误分类按调用方可处置语义拆分：
 * 引用形状非法沿用 CanonicalViolationError；以下四类覆盖寻址、缺失、完整性与协议冲突。
 */
export class ArtifactNamespaceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ArtifactNamespaceError";
  }
}

export class ArtifactNotFoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ArtifactNotFoundError";
  }
}

/*
 * ArtifactIntegrityError 表示已持久化字节与引用摘要不符：截断、腐化或同 hash 不同内容。
 * 它永远 fail closed，不存在自动修复或自动覆盖已落盘对象的路径。
 */
export class ArtifactIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ArtifactIntegrityError";
  }
}

/*
 * ArtifactConflictError 专用于确定性 receipt：同一稳定协议键写入了不同内容，属于协议冲突。
 * 同键同内容重试是合法幂等，不进入本错误。
 */
export class ArtifactConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ArtifactConflictError";
  }
}
