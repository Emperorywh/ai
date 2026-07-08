import { defineConfig } from 'vitest/config'

/**
 * Vitest 配置。
 *
 * passWithNoTests: true —— 脚手架阶段尚无测试用例时，
 * 保证 `npm test` 退出码为 0，与 TASK-001 验收标准一致。
 * 后续任务接入真实测试后该选项仍然无害（有用例时正常跑）。
 */
export default defineConfig({
  test: {
    passWithNoTests: true,
  },
})
