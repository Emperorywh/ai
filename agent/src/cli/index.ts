#!/usr/bin/env node
/**
 * CLI bin 入口（package.json 的 bin.caw 指向编译产物 dist/cli/index.js）。
 * 本文件不含命令逻辑，仅经 framework.runCli 编排命令并以退出码结束进程。
 */
import { runCli } from './framework.js'

runCli(process.argv.slice(2))
  .then((exitCode) => process.exit(exitCode))
  .catch(() => process.exit(1))
