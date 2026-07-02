import { parseRunnerCliArgs, validateTaskQueue } from './task-lib.mjs';

/*
 * 这个入口只做执行前硬闸门校验。
 * 它不会调用 Claude、不会切分支、不会提交代码，
 * 适合在确认 PLAN/tasks 后先跑一次，提前阻断错误假设进入开发阶段。
 */
try {
  validateTaskQueue(parseRunnerCliArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
