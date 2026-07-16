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
 * CandidateChangedError 表达冻结候选与当前文件树不一致的稳定业务语义。
 * 应用层可将其收敛为 blocked，其他 Git 或文件系统故障仍按基础设施错误传播。
 */
export class CandidateChangedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CandidateChangedError";
  }
}
