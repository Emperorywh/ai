import { rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const distDir = resolve(projectRoot, 'dist')

/**
 * 破坏式重构会删除源码模块，TypeScript 本身不会清理对应的旧构建文件。
 * 构建前只允许删除项目根目录下固定的 dist，防止旧命令继续进入发布产物。
 */
if (dirname(distDir) !== projectRoot) {
  throw new Error(`构建输出目录越界：${distDir}`)
}
rmSync(distDir, { recursive: true, force: true })

const tscEntry = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc')
const result = spawnSync(process.execPath, [tscEntry, '-p', 'tsconfig.build.json'], {
  cwd: projectRoot,
  stdio: 'inherit',
})

/**
 * 子进程异常和 TypeScript 非零退出统一映射为构建失败。
 * npm 只观察本脚本退出码，不需要理解底层编译器进程状态。
 */
if (result.error) throw result.error
process.exitCode = result.status ?? 1
