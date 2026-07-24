/*
 * 项目契约投影测试锁定完整正文参与语义：
 * 等价换行不改变 contract hash，正文、结构化字段或有序数组的任一有效变化都会改变对应摘要。
 */
import { describe, expect, it } from "vitest";
import { encodeCanonicalUtf8 } from "../src/domain/canonical-json.js";
import type { TaskDefinition } from "../src/domain/project.js";
import {
  createProjectHash,
  createSpecContractHash,
  createTaskContractHash,
  splitTaskDocument,
} from "../src/domain/project-contract.js";
import {
  createPredecessorCompletionFingerprint,
  predecessorCompletionProjectionSchema,
} from "../src/domain/task-completion.js";
import { CanonicalViolationError } from "../src/domain/errors.js";
import { NodeCanonicalHashService } from "../src/infrastructure/canonical/node-canonical-hash-service.js";

const canonicalHash = new NodeCanonicalHashService();

const demoTask: TaskDefinition = {
  id: "TASK-001",
  title: "实现第一个任务",
  file: "orchestration/tasks/TASK-001.md",
};

function createTaskDocument(body: string): string {
  return `---\nid: TASK-001\ntitle: 实现第一个任务\n---\n\n## 任务描述\n\n${body}\n`;
}

describe("splitTaskDocument", () => {
  it("拆分前置元数据与完整正文", () => {
    const split = splitTaskDocument(createTaskDocument("任务正文。"));

    expect(split?.frontMatter).toBe("id: TASK-001\ntitle: 实现第一个任务");
    expect(split?.body).toBe("\n## 任务描述\n\n任务正文。\n");
  });

  it("缺少前置元数据时返回 undefined", () => {
    expect(splitTaskDocument("# 没有元数据\n")).toBeUndefined();
  });
});

describe("createSpecContractHash", () => {
  it("同一规范化正文重复计算得到相同 contract hash", () => {
    const body = "# SPEC\n\n完整规格与架构约束。\n";

    expect(createSpecContractHash(body, canonicalHash)).toBe(
      createSpecContractHash(body, canonicalHash),
    );
  });

  it("正文任一变化都会改变 contract hash", () => {
    const base = createSpecContractHash("# SPEC\n\n完整规格。\n", canonicalHash);

    expect(
      createSpecContractHash("# SPEC\n\n完整规格，补充一句。\n", canonicalHash),
    ).not.toBe(base);
  });
});

describe("createTaskContractHash", () => {
  it("等价换行的正文得到相同 contract hash", () => {
    const lfBody = "\n## 任务描述\n\n任务正文。\n";
    const crlfSource = createTaskDocument("任务正文。").replaceAll("\n", "\r\n");
    /*
     * CRLF 源文本在加载边界归一化为 LF，因此投影输入与 LF 版本完全一致。
     */
    const normalized = crlfSource.replaceAll("\r\n", "\n");
    const crlfBody = splitTaskDocument(normalized)?.body ?? "";
    const specContractHash = createSpecContractHash("# SPEC\n", canonicalHash);

    expect(crlfBody).toBe(lfBody);
    expect(
      createTaskContractHash(
        { task: demoTask, body: crlfBody, specContractHash },
        canonicalHash,
      ),
    ).toBe(
      createTaskContractHash(
        { task: demoTask, body: lfBody, specContractHash },
        canonicalHash,
      ),
    );
  });

  it("正文变化但 YAML 未改时 contract hash 必须变化", () => {
    const specContractHash = createSpecContractHash("# SPEC\n", canonicalHash);
    const base = createTaskContractHash(
      {
        task: demoTask,
        body: splitTaskDocument(createTaskDocument("任务正文。"))?.body ?? "",
        specContractHash,
      },
      canonicalHash,
    );
    const changed = createTaskContractHash(
      {
        task: demoTask,
        body: splitTaskDocument(createTaskDocument("任务正文，补充验收事实。"))
          ?.body ?? "",
        specContractHash,
      },
      canonicalHash,
    );

    expect(changed).not.toBe(base);
  });

  it("SPEC 契约变化会使任务契约失效", () => {
    const body = splitTaskDocument(createTaskDocument("任务正文。"))?.body ?? "";
    const base = createTaskContractHash(
      {
        task: demoTask,
        body,
        specContractHash: createSpecContractHash("# SPEC v1\n", canonicalHash),
      },
      canonicalHash,
    );
    const changed = createTaskContractHash(
      {
        task: demoTask,
        body,
        specContractHash: createSpecContractHash("# SPEC v2\n", canonicalHash),
      },
      canonicalHash,
    );

    expect(changed).not.toBe(base);
  });

  it("标题或 id 变化会改变 contract hash", () => {
    const body = splitTaskDocument(createTaskDocument("任务正文。"))?.body ?? "";
    const specContractHash = createSpecContractHash("# SPEC\n", canonicalHash);
    const base = createTaskContractHash(
      { task: demoTask, body, specContractHash },
      canonicalHash,
    );

    expect(
      createTaskContractHash(
        {
          task: { ...demoTask, title: "实现更名后的任务" },
          body,
          specContractHash,
        },
        canonicalHash,
      ),
    ).not.toBe(base);
    expect(
      createTaskContractHash(
        { task: { ...demoTask, id: "TASK-002" }, body, specContractHash },
        canonicalHash,
      ),
    ).not.toBe(base);
  });
});

describe("createProjectHash", () => {
  const specification = {
    path: "orchestration/SPEC.md",
    sourceHash: canonicalHash.digestBytes(encodeCanonicalUtf8("# SPEC\n")),
  };
  const taskA = {
    path: "orchestration/tasks/TASK-001.md",
    sourceHash: canonicalHash.digestBytes(encodeCanonicalUtf8("A")),
  };
  const taskB = {
    path: "orchestration/tasks/TASK-002.md",
    sourceHash: canonicalHash.digestBytes(encodeCanonicalUtf8("B")),
  };

  it("相同项目重复计算得到相同 project hash", () => {
    expect(
      createProjectHash(
        { specification, tasks: [taskA, taskB] },
        canonicalHash,
      ),
    ).toBe(
      createProjectHash(
        { specification, tasks: [taskA, taskB] },
        canonicalHash,
      ),
    );
  });

  it("有序任务数组的顺序变化会改变 project hash", () => {
    const base = createProjectHash(
      { specification, tasks: [taskA, taskB] },
      canonicalHash,
    );

    expect(
      createProjectHash(
        { specification, tasks: [taskB, taskA] },
        canonicalHash,
      ),
    ).not.toBe(base);
  });

  it("任一源摘要变化都会改变 project hash", () => {
    const base = createProjectHash(
      { specification, tasks: [taskA] },
      canonicalHash,
    );

    expect(
      createProjectHash(
        {
          specification: {
            ...specification,
            sourceHash: canonicalHash.digestBytes(encodeCanonicalUtf8("# 变更\n")),
          },
          tasks: [taskA],
        },
        canonicalHash,
      ),
    ).not.toBe(base);
  });
});

describe("createPredecessorCompletionFingerprint", () => {
  it("根任务与后继任务使用同一规范哈希入口", () => {
    const root = createPredecessorCompletionFingerprint(undefined, canonicalHash);
    const next = createPredecessorCompletionFingerprint(
      { taskId: "TASK-001", commitSha: "a".repeat(40) },
      canonicalHash,
    );

    expect(root).toMatch(/^[0-9a-f]{64}$/u);
    expect(next).toMatch(/^[0-9a-f]{64}$/u);
    expect(next).not.toBe(root);
    expect(
      createPredecessorCompletionFingerprint(
        { taskId: "TASK-001", commitSha: "a".repeat(40) },
        canonicalHash,
      ),
    ).toBe(next);
  });

  it("拒绝 Schema 外联合分支与非法提交 OID", () => {
    const service = new NodeCanonicalHashService();

    expect(() =>
      createPredecessorCompletionFingerprint(
        { taskId: "TASK-001", commitSha: "not-an-oid" },
        service,
      )
    ).toThrow(CanonicalViolationError);
    expect(() =>
      createPredecessorCompletionFingerprint(
        { taskId: "TASK-001", commitSha: "A".repeat(40) },
        service,
      )
    ).toThrow(CanonicalViolationError);
  });

  it("拒绝未知联合分支、多余字段和缺失字段", () => {
    const service = new NodeCanonicalHashService();

    expect(() =>
      service.digestStructured(predecessorCompletionProjectionSchema, {
        schemaVersion: 1,
        predecessor: "trunk",
      })
    ).toThrow(CanonicalViolationError);
    expect(() =>
      service.digestStructured(predecessorCompletionProjectionSchema, {
        schemaVersion: 1,
        predecessor: {
          taskId: "TASK-001",
          commitSha: "a".repeat(40),
          extra: true,
        },
      })
    ).toThrow(CanonicalViolationError);
    expect(() =>
      service.digestStructured(predecessorCompletionProjectionSchema, {
        schemaVersion: 1,
        predecessor: { taskId: "TASK-001" },
      })
    ).toThrow(CanonicalViolationError);
  });
});
