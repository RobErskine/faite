import { describe, expect, it } from "vitest";
import { encodeHlc } from "@/lib/sync/hlc-core";
import { buildCreateTodoEntry, buildUpdateTodoEntry } from "./todos";
import type { ServiceContext } from "./context";

function fakeContext(overrides: Partial<ServiceContext> = {}): ServiceContext {
  let counter = 0;
  return {
    userId: "user-1",
    // A stable, obviously-fake node id — NOT a stand-in for a real answer to
    // docs/API.md's open "who stamps the HLC" question. See context.ts.
    nextHlc: () => encodeHlc({ phys: 1000, counter: counter++, nodeId: "test-node" }),
    ...overrides,
  };
}

describe("buildCreateTodoEntry", () => {
  it("builds a valid PushEntry for a minimal input", () => {
    const ctx = fakeContext();
    const entry = buildCreateTodoEntry(ctx, { title: "Buy milk" });

    expect(entry.kind).toBe("todo");
    expect(entry.entityId).toBeTruthy();
    expect(entry.hlc).toBe(encodeHlc({ phys: 1000, counter: 0, nodeId: "test-node" }));
    expect(entry.patch).toMatchObject({
      title: "Buy milk",
      status: "open",
      ownerId: "user-1",
      deletedAt: null,
      scheduledAt: null,
      parentId: null,
    });
  });

  it("carries optional fields through untouched", () => {
    const ctx = fakeContext();
    const entry = buildCreateTodoEntry(ctx, {
      title: "Call dentist",
      priority: 2,
      scheduledDate: "2026-08-20",
      labelIds: ["label-1"],
    });

    expect(entry.patch).toMatchObject({
      priority: 2,
      scheduledDate: "2026-08-20",
      labelIds: ["label-1"],
    });
  });

  it("each call gets a fresh outbox entry id and entity id", () => {
    const ctx = fakeContext();
    const a = buildCreateTodoEntry(ctx, { title: "A" });
    const b = buildCreateTodoEntry(ctx, { title: "B" });

    expect(a.id).not.toBe(b.id);
    expect(a.entityId).not.toBe(b.entityId);
  });
});

describe("buildUpdateTodoEntry", () => {
  it("builds a valid PushEntry for a partial patch", () => {
    const ctx = fakeContext();
    const entry = buildUpdateTodoEntry(ctx, "todo-1", { status: "done" });

    expect(entry.kind).toBe("todo");
    expect(entry.entityId).toBe("todo-1");
    expect(entry.patch).toEqual({ status: "done" });
  });

  it("throws on an empty patch rather than pushing a no-op entry", () => {
    const ctx = fakeContext();
    expect(() => buildUpdateTodoEntry(ctx, "todo-1", {})).toThrow(/empty patch/);
  });

  it("rejects a patch that fails schema validation", () => {
    const ctx = fakeContext();
    expect(() =>
      // @ts-expect-error deliberately invalid: status is not a real TodoStatus
      buildUpdateTodoEntry(ctx, "todo-1", { status: "not-a-status" }),
    ).toThrow();
  });
});
