import { parseRunnerCliArgs, runNextTask } from './task-lib.mjs';

/*
 * 单任务入口只负责解析 CLI 参数并启动一个 ready task。
 * 状态流、schema 校验、git 校验、Claude 调用和日志都封装在 task-lib 中，
 * 这样命令入口保持很薄，后续也更容易被 CI 或其它脚本复用。
 */
try {
  await runNextTask(parseRunnerCliArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
