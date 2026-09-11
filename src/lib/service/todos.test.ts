import { describe, expect, it } from "vitest";
import { encodeHlc } from "@/lib/sync/hlc-core";
import { buildCreateTodoEntry, buildUpdateTodoEntry, UPDATE_TODO_MAX_ENTRIES } from "./todos";
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

  describe("EI-321: status and date changes are logged as decisions", () => {
    const open = { status: "open" as const, scheduledDate: "2026-09-10" };
    const kindsOf = (entries: ReturnType<typeof buildUpdateTodoEntry>) =>
      entries
        .filter((e) => e.kind === "todoEvent")
        .map((e) => (e.patch as Record<string, unknown>).kind);
    const payloadOf = (entries: ReturnType<typeof buildUpdateTodoEntry>, kind: string) =>
      JSON.parse(
        (entries.find((e) => (e.patch as Record<string, unknown>).kind === kind)!.patch as Record<
          string,
          string
        >).payload,
      );

    it("REGRESSION: completing from MCP/Raycast/the API logs `done`", () => {
      const entries = buildUpdateTodoEntry(fakeContext(), "todo-1", { status: "done" }, open);
      expect(kindsOf(entries)).toEqual(["done"]);
    });

    it("logs `dropped` and `reopened` the way setTodoStatus does", () => {
      expect(kindsOf(buildUpdateTodoEntry(fakeContext(), "t", { status: "dropped" }, open))).toEqual([
        "dropped",
      ]);
      const done = { ...open, status: "done" as const };
      expect(kindsOf(buildUpdateTodoEntry(fakeContext(), "t", { status: "open" }, done))).toEqual([
        "reopened",
      ]);
    });

    it("logs nothing for a status set to what it already was", () => {
      expect(kindsOf(buildUpdateTodoEntry(fakeContext(), "t", { status: "open" }, open))).toEqual([]);
    });

    it("logs a date change as `scheduled {from, to}`, not `edited`", () => {
      const entries = buildUpdateTodoEntry(fakeContext(), "t", { scheduledDate: "2026-09-12" }, open);
      expect(kindsOf(entries)).toEqual(["scheduled"]);
      expect(payloadOf(entries, "scheduled")).toEqual({ v: 1, from: "2026-09-10", to: "2026-09-12" });
    });

    it("logs clearing the date as `unscheduled`", () => {
      const entries = buildUpdateTodoEntry(fakeContext(), "t", { scheduledDate: null }, open);
      expect(kindsOf(entries)).toEqual(["unscheduled"]);
      expect(payloadOf(entries, "unscheduled")).toEqual({ v: 1, from: "2026-09-10", to: null });
    });

    it("keeps the other fields in one `edited` row beside it", () => {
      const entries = buildUpdateTodoEntry(
        fakeContext(),
        "t",
        { title: "New", scheduledDate: "2026-09-12" },
        open,
      );
      expect(kindsOf(entries)).toEqual(["edited", "scheduled"]);
      expect(payloadOf(entries, "edited").fields).toEqual(["title"]);
    });

    it("without the stored row, behaves as before: `edited`, no status event", () => {
      const entries = buildUpdateTodoEntry(fakeContext(), "t", { status: "done", scheduledDate: "2026-09-12" });
      expect(kindsOf(entries)).toEqual(["edited"]);
    });

    it("never returns more entries than UPDATE_TODO_MAX_ENTRIES, which callers size the HLC queue with", () => {
      const entries = buildUpdateTodoEntry(
        fakeContext(),
        "t",
        { title: "New", status: "done", scheduledDate: "2026-09-12" },
        open,
      );
      expect(entries).toHaveLength(UPDATE_TODO_MAX_ENTRIES);
    });
  });

  it("rejects a patch that fails schema validation", () => {
    const ctx = fakeContext();
    expect(() =>
      // @ts-expect-error deliberately invalid: status is not a real TodoStatus
      buildUpdateTodoEntry(ctx, "todo-1", { status: "not-a-status" }),
    ).toThrow();
  });
});
