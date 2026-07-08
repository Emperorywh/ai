/**
 * Application 编排层入口。
 *
 * 职责：编排用例流程（规划、Context Pack 生成、调度、状态编排、合并）。
 * 硬约束：不直接 import infrastructure 实现类，
 * 一律经 src/application/ports.ts 中的窄接口（Port）依赖基础设施。
 *
 * 后续任务（TASK-015 起）在此导出各用例。
 */
export {}
