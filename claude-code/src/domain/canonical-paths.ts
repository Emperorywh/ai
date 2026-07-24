/*
 * Git 相对 POSIX 路径的规范校验在项目加载时执行，非法路径在哈希前 fail closed。
 * 路径必须是 UTF-8、仓库相对 POSIX 表示且已经是 Unicode NFC；
 * 非 NFC 路径、规范化碰撞、大小写折叠碰撞和目标平台不可表示路径一律拒绝，
 * 禁止在哈希时静默改写路径。
 */
import { CanonicalViolationError } from "./errors.js";
import { assertUnicodeScalarText } from "./canonical-unicode.js";

const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/u;
const WINDOWS_ILLEGAL_CHARACTER_PATTERN = /[<>:"|?*]/u;
const WINDOWS_RESERVED_NAME_PATTERN = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])$/iu;

export function assertCanonicalGitPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): void {
  /*
   * 路径必须能无损编码为 UTF-8；孤立代理项不能等到 TextEncoder 或文件系统边界
   * 再被替换，否则校验身份与真实路径字节会发生漂移。
   */
  assertUnicodeScalarText(path, "Git 路径");
  if (path.length === 0) {
    throw new CanonicalViolationError("Git 路径不能为空");
  }
  if (hasControlCharacter(path)) {
    throw new CanonicalViolationError(`Git 路径包含控制字符：${path}`);
  }
  if (path.includes("\\")) {
    throw new CanonicalViolationError(`Git 路径必须使用 POSIX 分隔符：${path}`);
  }
  if (path.startsWith("/") || WINDOWS_DRIVE_PATTERN.test(path)) {
    throw new CanonicalViolationError(`Git 路径必须是仓库相对路径：${path}`);
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new CanonicalViolationError(`Git 路径包含空路径段：${path}`);
    }
    if (segment === "." || segment === "..") {
      throw new CanonicalViolationError(`Git 路径不允许相对路径段：${path}`);
    }
  }
  if (path.normalize("NFC") !== path) {
    throw new CanonicalViolationError(`Git 路径不是 Unicode NFC 规范形式：${path}`);
  }
  if (platform === "win32") {
    for (const segment of segments) {
      assertWindowsRepresentableSegment(segment, path);
    }
  }
}

/*
 * 路径集合整体校验规范化碰撞和大小写折叠碰撞。
 * 任一碰撞都会导致同一文件在不同平台上得到不同字节身份，必须拒绝整个项目。
 */
export function assertCanonicalGitPathSet(
  paths: readonly string[],
  platform: NodeJS.Platform = process.platform,
): void {
  for (const path of paths) {
    assertCanonicalGitPath(path, platform);
  }
  assertNoCollision(
    paths,
    (path) => path.normalize("NFC"),
    "规范化碰撞",
  );
  assertNoCollision(
    paths,
    (path) => path.toLowerCase(),
    "大小写折叠碰撞",
  );
}

function assertWindowsRepresentableSegment(
  segment: string,
  path: string,
): void {
  if (WINDOWS_ILLEGAL_CHARACTER_PATTERN.test(segment)) {
    throw new CanonicalViolationError(
      `Git 路径包含 Windows 不可表示字符：${path}`,
    );
  }
  if (segment.endsWith(".") || segment.endsWith(" ")) {
    throw new CanonicalViolationError(
      `Git 路径段以 Windows 不可表示的字符结尾：${path}`,
    );
  }
  const stem = segment.split(".", 1)[0] ?? segment;
  if (WINDOWS_RESERVED_NAME_PATTERN.test(stem)) {
    throw new CanonicalViolationError(`Git 路径使用 Windows 保留设备名：${path}`);
  }
}

function assertNoCollision(
  paths: readonly string[],
  canonicalForm: (path: string) => string,
  label: string,
): void {
  const seen = new Map<string, string>();
  for (const path of paths) {
    const form = canonicalForm(path);
    const existing = seen.get(form);
    if (existing !== undefined && existing !== path) {
      throw new CanonicalViolationError(
        `Git 路径${label}：${existing} 与 ${path}`,
      );
    }
    seen.set(form, path);
  }
}

function hasControlCharacter(path: string): boolean {
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}
