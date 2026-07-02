import { loadTasks, printTaskStatus } from './task-lib.mjs';

/*
 * 状态命令只读任务文件，不触碰 git，也不修改任何状态。
 * 它适合在执行前后快速检查队列推进情况，
 * 也方便后续接入 dashboard 或 CI 日志。
 */
printTaskStatus(loadTasks());
