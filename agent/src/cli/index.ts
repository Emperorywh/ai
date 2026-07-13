#!/usr/bin/env node
import { runCli } from './framework.js'

/**
 * 可执行入口只转交参数并设置退出码。
 * 具体命令装配和错误处理全部位于 CLI 框架中。
 */
process.exitCode = await runCli(process.argv.slice(2))
