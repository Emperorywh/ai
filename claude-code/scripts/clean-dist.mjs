/*
 * 发布构建必须从空目录开始，避免已删除模块继续残留在 npm 包的 dist 中。
 * 目标路径由脚本自身位置静态推导，不接受外部输入，删除范围始终限定为仓库内 dist。
 */
import { rm } from "node:fs/promises";

await rm(new URL("../dist/", import.meta.url), {
  recursive: true,
  force: true,
});
