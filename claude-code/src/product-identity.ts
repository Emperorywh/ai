/*
 * 产品身份是 npm 包、全局命令、Git 状态命名空间与持久元数据的唯一事实源。
 * 这些值属于全新系统的稳定外部契约，基础设施不得再自行拼接旧品牌或兼容标识。
 */
export const PRODUCT_IDENTITY = Object.freeze({
  displayName: "Apex Coding Agent",
  slug: "apex-coding-agent",
  gitReferenceRoot: "refs/apex-coding-agent",
  gitTrailers: Object.freeze({
    run: "Apex-Coding-Agent-Run",
    project: "Apex-Coding-Agent-Project",
    task: "Apex-Coding-Agent-Task",
    candidate: "Apex-Coding-Agent-Candidate",
    taskContract: "Apex-Coding-Agent-Task-Contract",
    taskPredecessor: "Apex-Coding-Agent-Task-Predecessor",
  }),
});
