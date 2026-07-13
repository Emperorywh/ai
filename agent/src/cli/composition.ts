import { ClaudeCodeAgent, FileWorkflowRepository } from '../infrastructure/index.js'

/**
 * CLI 是唯一的 composition root，集中创建真实基础设施。
 * 应用用例只接收端口，不直接依赖 Claude SDK 或本地文件系统。
 */
export function createRuntime(projectRoot: string, reporter?: (message: string) => void): {
  readonly repository: FileWorkflowRepository
  readonly agent: ClaudeCodeAgent
} {
  return {
    repository: new FileWorkflowRepository(projectRoot),
    agent: new ClaudeCodeAgent(projectRoot, reporter),
  }
}
