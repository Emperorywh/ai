/*
 * CLI 版本直接读取随 npm 包发布的 manifest，避免源码常量与发布版本形成两个事实源。
 * 包名同时按产品身份校验，错误打包会在命令启动阶段立即暴露，而不是生成错误的全局入口。
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { PRODUCT_IDENTITY } from "../product-identity.js";

const packageManifestSchema = z.looseObject({
  name: z.literal(PRODUCT_IDENTITY.slug),
  version: z.string().trim().min(1),
});

export async function readPackageVersion(): Promise<string> {
  const content = await readFile(
    new URL("../../package.json", import.meta.url),
    "utf8",
  );
  return packageManifestSchema.parse(JSON.parse(content) as unknown).version;
}
