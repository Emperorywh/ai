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
