import type { TaskRecord } from '../core/workflow.js'
import type { CodingAgentPort, WorkflowRepositoryPort } from './ports.js'

/**
 * 任务生成只消费最终规格，不读取代码并且不产出实现约束。
 * 文件编号、初始状态和 Markdown 模板由仓储统一负责。
 */
export class GenerateTasksUseCase {
  constructor(
    private readonly agent: CodingAgentPort,
    private readonly repository: WorkflowRepositoryPort,
  ) {}

  async execute(): Promise<readonly TaskRecord[]> {
    const specification = this.repository.readSpecification()
    const tasks = await this.agent.createTaskPlan(specification)
    return this.repository.replaceTasks(tasks)
  }
}
