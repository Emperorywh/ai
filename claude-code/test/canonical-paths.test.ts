/*
 * Git 路径规范测试锁定 NFC、碰撞与平台可表示性规则。
 * 非法路径必须在项目加载时被拒绝，不能进入哈希或证据链。
 */
import { describe, expect, it } from "vitest";
import {
  assertCanonicalGitPath,
  assertCanonicalGitPathSet,
} from "../src/domain/canonical-paths.js";

const nfdPath = `docs/e${String.fromCharCode(0x301)}.md`;
const nfcPath = `docs/${String.fromCharCode(0xe9)}.md`;

describe("assertCanonicalGitPath", () => {
  it("接受合法的仓库相对 POSIX 路径", () => {
    expect(() =>
      assertCanonicalGitPath("orchestration/tasks/TASK-001.md")
    ).not.toThrow();
    expect(() => assertCanonicalGitPath("a")).not.toThrow();
    expect(() => assertCanonicalGitPath(nfcPath)).not.toThrow();
  });

  it("拒绝空路径、绝对路径、盘符和反斜杠", () => {
    expect(() => assertCanonicalGitPath("")).toThrow("不能为空");
    expect(() => assertCanonicalGitPath("/abs/path")).toThrow("仓库相对路径");
    expect(() => assertCanonicalGitPath("C:/abs/path")).toThrow(
      "仓库相对路径",
    );
    expect(() => assertCanonicalGitPath("a\\b")).toThrow("POSIX 分隔符");
  });

  it("拒绝空段、当前段和父段", () => {
    expect(() => assertCanonicalGitPath("a//b")).toThrow("空路径段");
    expect(() => assertCanonicalGitPath("a/")).toThrow("空路径段");
    expect(() => assertCanonicalGitPath("./a")).toThrow("相对路径段");
    expect(() => assertCanonicalGitPath("a/../b")).toThrow("相对路径段");
  });

  it("拒绝控制字符与 NUL", () => {
    const withControl = `a${String.fromCharCode(1)}b`;
    const withNul = `a${String.fromCharCode(0)}b`;
    const withDelete = `a${String.fromCharCode(0x7f)}b`;

    expect(() => assertCanonicalGitPath(withControl)).toThrow("控制字符");
    expect(() => assertCanonicalGitPath(withNul)).toThrow("控制字符");
    expect(() => assertCanonicalGitPath(withDelete)).toThrow("控制字符");
  });

  it("拒绝无法无损编码为 UTF-8 的孤立代理项", () => {
    const loneHigh = `docs/${String.fromCharCode(0xd800)}.md`;
    const loneLow = `docs/${String.fromCharCode(0xdc00)}.md`;

    expect(() => assertCanonicalGitPath(loneHigh, "linux")).toThrow(
      "孤立高位代理",
    );
    expect(() => assertCanonicalGitPath(loneLow, "win32")).toThrow(
      "孤立低位代理",
    );
  });

  it("拒绝非 NFC 路径", () => {
    expect(() => assertCanonicalGitPath(nfdPath)).toThrow(
      "不是 Unicode NFC 规范形式",
    );
  });

  it("Windows 目标拒绝不可表示路径", () => {
    for (const path of [
      "docs/CON",
      "docs/con.txt",
      "docs/COM1",
      "docs/lpt9.md",
      "docs/aux",
      "docs/nul",
      "docs/clock$",
      "docs/a.",
      "docs/a ",
      "docs/a:b",
      "docs/a<b",
      "docs/a|b",
    ]) {
      expect(() => assertCanonicalGitPath(path, "win32")).toThrow();
    }
  });

  it("Windows 目标接受非保留近似名", () => {
    expect(() => assertCanonicalGitPath("docs/conx.txt", "win32")).not.toThrow();
    expect(() => assertCanonicalGitPath("docs/com10", "win32")).not.toThrow();
    expect(() => assertCanonicalGitPath("docs/a.b", "win32")).not.toThrow();
  });

  it("POSIX 目标不拒绝 Windows 专属非法形状", () => {
    expect(() => assertCanonicalGitPath("docs/CON.txt", "linux")).not.toThrow();
    expect(() => assertCanonicalGitPath("docs/a:b", "linux")).not.toThrow();
    expect(() => assertCanonicalGitPath("docs/a.", "linux")).not.toThrow();
  });
});

describe("assertCanonicalGitPathSet", () => {
  it("接受无碰撞的规范路径集合", () => {
    expect(() =>
      assertCanonicalGitPathSet([
        "orchestration/SPEC.md",
        "orchestration/tasks/TASK-001.md",
        nfcPath,
      ])
    ).not.toThrow();
  });

  /*
   * 规范化碰撞的两个路径中必有一个不是 NFC，逐路径校验会先行拒绝；
   * 集合级 NFC 碰撞检查作为第二道防线保留。
   */
  it("拒绝规范化碰撞", () => {
    expect(() => assertCanonicalGitPathSet([nfcPath, nfdPath])).toThrow(
      "NFC",
    );
  });

  it("拒绝大小写折叠碰撞", () => {
    expect(() =>
      assertCanonicalGitPathSet(["docs/Readme.md", "docs/README.md"])
    ).toThrow("大小写折叠碰撞");
    expect(() =>
      assertCanonicalGitPathSet(["docs/a.md", "docs/A.md"])
    ).toThrow("大小写折叠碰撞");
  });

  it("集合校验同时应用平台可表示性", () => {
    expect(() =>
      assertCanonicalGitPathSet(["docs/a.md", "docs/CON.txt"], "win32")
    ).toThrow();
    expect(() =>
      assertCanonicalGitPathSet(["docs/a.md", "docs/CON.txt"], "linux")
    ).not.toThrow();
  });
});
