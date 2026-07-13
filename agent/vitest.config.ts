import { defineConfig } from 'vitest/config'

/**
 * Vitest 配置。
 *
 * MVP 已有核心回归用例，因此不允许“没有测试”被视为成功。
 * 使用 Vitest 默认失败语义，避免 CI 在测试意外丢失时静默通过。
 */
export default defineConfig({})
