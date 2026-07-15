/*
 * 公共入口只导出稳定领域契约、应用服务与可替换端口，不暴露 CLI 的参数解析副作用。
 * 高级使用者可以自行装配端口，默认命令行用户则通过内置组合根获得文件与 Git 实现。
 */
export * from "./application/prompt-builder.js";
export * from "./application/queue-orchestrator.js";
export * from "./application/run-state-presentation.js";
export * from "./application/task-execution-service.js";
export * from "./application/task-progress-reconciler.js";
export * from "./domain/agent-result.js";
export * from "./domain/dag.js";
export * from "./domain/errors.js";
export * from "./domain/manifest.js";
export * from "./domain/run-state.js";
export * from "./domain/task-completion.js";
export * from "./ports/agent-executor.js";
export * from "./ports/clock.js";
export * from "./ports/event-logger.js";
export * from "./ports/gate-runner.js";
export * from "./ports/manifest-repository.js";
export * from "./ports/run-lock.js";
export * from "./ports/state-store.js";
export * from "./ports/time-formatter.js";
export * from "./ports/workspace.js";
