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
  it("builds a valid PushEntry for a minimal input, plus its 'created' todoEvent", () => {
    const ctx = fakeContext();
    const entries = buildCreateTodoEntry(ctx, { title: "Buy milk" });

    expect(entries).toHaveLength(2);
    const [todoEntry, eventEntry] = entries;

    expect(todoEntry.kind).toBe("todo");
    expect(todoEntry.entityId).toBeTruthy();
    expect(todoEntry.hlc).toBe(encodeHlc({ phys: 1000, counter: 0, nodeId: "test-node" }));
    expect(todoEntry.patch).toMatchObject({
      title: "Buy milk",
      status: "open",
      ownerId: "user-1",
      deletedAt: null,
      scheduledAt: null,
      parentId: null,
    });

    expect(eventEntry.kind).toBe("todoEvent");
    expect(eventEntry.hlc).not.toBe(todoEntry.hlc);
    const eventPatch = eventEntry.patch as Record<string, unknown>;
    expect(eventPatch.todoId).toBe(todoEntry.entityId);
    expect(eventPatch.kind).toBe("created");
    expect(eventPatch.payload).toBeNull();
  });

  it("carries optional fields through untouched", () => {
    const ctx = fakeContext();
    const [todoEntry] = buildCreateTodoEntry(ctx, {
      title: "Call dentist",
      priority: 2,
      scheduledDate: "2026-08-20",
      labelIds: ["label-1"],
    });

    expect(todoEntry.patch).toMatchObject({
      priority: 2,
      scheduledDate: "2026-08-20",
      labelIds: ["label-1"],
    });
  });

  it("REGRESSION (parity gap #2): parentId is threaded through, not hard-coded null", () => {
    const ctx = fakeContext();
    const [todoEntry] = buildCreateTodoEntry(ctx, { title: "Subtask", parentId: "parent-1" });
    expect((todoEntry.patch as Record<string, unknown>).parentId).toBe("parent-1");
  });

  it("each call gets a fresh outbox entry id and entity id", () => {
    const ctx = fakeContext();
    const [a] = buildCreateTodoEntry(ctx, { title: "A" });
    const [b] = buildCreateTodoEntry(ctx, { title: "B" });

    expect(a.id).not.toBe(b.id);
    expect(a.entityId).not.toBe(b.entityId);
  });
});

describe("buildUpdateTodoEntry", () => {
  it("builds a valid PushEntry for a partial patch", () => {
    const ctx = fakeContext();
    const [todoEntry] = buildUpdateTodoEntry(ctx, "todo-1", { status: "done" });

    expect(todoEntry.kind).toBe("todo");
    expect(todoEntry.entityId).toBe("todo-1");
    expect(todoEntry.patch).toMatchObject({ status: "done" });
  });

  it("REGRESSION (parity gap #4): stamps updatedAt, which mutate() does on every client write", () => {
    const ctx = fakeContext();
    const [todoEntry] = buildUpdateTodoEntry(ctx, "todo-1", { status: "done" });
    expect(typeof (todoEntry.patch as Record<string, unknown>).updatedAt).toBe("string");
  });

  it("REGRESSION (parity gap #3): emits an 'edited' todoEvent when the patch touches a journalled field", () => {
    const ctx = fakeContext();
    const entries = buildUpdateTodoEntry(ctx, "todo-1", { title: "New title" });

    expect(entries).toHaveLength(2);
    const [todoEntry, eventEntry] = entries;
    expect(eventEntry.kind).toBe("todoEvent");
    expect(eventEntry.hlc).not.toBe(todoEntry.hlc);
    const eventPatch = eventEntry.patch as Record<string, unknown>;
    expect(eventPatch.todoId).toBe("todo-1");
    expect(eventPatch.kind).toBe("edited");
    expect(JSON.parse(eventPatch.payload as string)).toMatchObject({ fields: ["title"] });
  });

  it("captures the new value for priority/deadline in the edited payload, but not title/description", () => {
    const ctx = fakeContext();
    const [, eventEntry] = buildUpdateTodoEntry(ctx, "todo-1", {
      title: "New title",
      priority: 1,
    });
    const payload = JSON.parse((eventEntry.patch as Record<string, unknown>).payload as string);
    expect(payload.to).toEqual({ priority: 1 });
  });

  it("logs no event for a patch that touches no journalled field (e.g. position only)", () => {
    const ctx = fakeContext();
    const entries = buildUpdateTodoEntry(ctx, "todo-1", { position: "a1" });
    expect(entries).toHaveLength(1);
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
