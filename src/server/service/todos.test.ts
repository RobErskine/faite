import { describe, expect, it, vi } from "vitest";
import { encodeHlc } from "@/lib/sync/hlc-core";
import type { ServiceContext } from "@/lib/service/context";
import { buildCreateTodoEntry, buildDeleteTodoEntry } from "@/lib/service/todos";
import { SYNC_PROTOCOL_VERSION, type PushResponse } from "@/lib/sync/wire";
import { groupByEntity, resolveEntityPush, validateEntries } from "../sync/push";
import { createTodo, deleteTodo, type PushTransport } from "./todos";

function fakeContext(): ServiceContext {
  let counter = 0;
  return {
    userId: "user-1",
    nextHlc: () => encodeHlc({ phys: 5000, counter: counter++, nodeId: "test-node" }),
  };
}

describe("service-layer builders feed the real push pipeline", () => {
  it("a built create batch survives validateEntries/groupByEntity/resolveEntityPush unrejected", () => {
    // No Durable Object involved — `push.ts`'s pipeline is pure (see its own
    // header comment), which is what makes this a real end-to-end check of
    // "would this actually apply" without standing up a DO in a test.
    // Two entries (the todo and its "created" todoEvent, A5/EI-230) — both
    // must survive the same real pipeline, not just the todo.
    const entries = buildCreateTodoEntry(fakeContext(), { title: "Ship the scaffold" });

    const { accepted, rejected } = validateEntries(entries);
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(2);

    const groups = groupByEntity(accepted);
    expect(groups).toHaveLength(2);

    const todoGroup = groups.find((g) => g.kind === "todo")!;
    const resolution = resolveEntityPush({}, todoGroup);

    expect(resolution.conflicts).toEqual([]);
    expect(resolution.apply).toMatchObject({ title: "Ship the scaffold", status: "open" });
    // ownerId is SERVER_ONLY — never applied from a client-shaped patch, even
    // though the builder set it. Confirms `sanitizePatch` (inside
    // `validateEntries`) strips it exactly like an ordinary client push.
    expect(resolution.apply.ownerId).toBeUndefined();

    const eventGroup = groups.find((g) => g.kind === "todoEvent")!;
    const eventResolution = resolveEntityPush({}, eventGroup);
    expect(eventResolution.apply).toMatchObject({ kind: "created" });
  });
});

describe("createTodo (server adapter)", () => {
  it("builds the todo + created-event batch and hands both to the injected PushTransport in one call", async () => {
    const response: PushResponse = { acked: ["e1", "e2"], rejected: [], highestVersion: 1, conflicts: [] };
    const push = vi.fn<PushTransport>().mockResolvedValue(response);

    const { response: result, todoId } = await createTodo(
      fakeContext(),
      { title: "Delegate this" },
      push,
    );

    expect(push).toHaveBeenCalledTimes(1);
    const [entries] = push.mock.calls[0];
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe("todo");
    expect(entries[0].patch).toMatchObject({ title: "Delegate this" });
    expect(entries[1].kind).toBe("todoEvent");
    expect(result).toBe(response);
    // REGRESSION: `response.acked` holds outbox ENTRY ids, never the
    // entity id — `todoId` must come from the built entry itself.
    expect(todoId).toBe(entries[0].entityId);
    expect(todoId).not.toBe(response.acked[0]);
  });
});

/**
 * A13 (EI-293). A soft delete is FOUR things, not one field — mirroring
 * `repositories.ts`'s `deleteTodo`. Each assertion below stands in for one
 * silent parity gap a `{ deletedAt }`-only route would have shipped.
 */
describe("buildDeleteTodoEntry", () => {
  const input = { title: "Buy milk", childIds: ["c1", "c2"], attachmentIds: ["a1"] };

  it("orphans children, tombstones attachment ROWS, logs the event, tombstones the todo", () => {
    const entries = buildDeleteTodoEntry(fakeContext(), "t1", input);

    // 2 children + 1 attachment + 1 event + the todo itself.
    expect(entries).toHaveLength(5);

    const children = entries.filter((e) => e.kind === "todo" && e.entityId !== "t1");
    expect(children.map((e) => e.entityId)).toEqual(["c1", "c2"]);
    // ORPHANED, not deleted — deleting a parent has never deleted sub-todos.
    for (const child of children) {
      expect(child.patch).toMatchObject({ parentId: null });
      expect(child.patch).not.toHaveProperty("deletedAt");
    }

    const attachment = entries.find((e) => e.kind === "attachment")!;
    expect(attachment.entityId).toBe("a1");
    expect(attachment.patch).toMatchObject({ deletedAt: expect.any(String) });

    const event = entries.find((e) => e.kind === "todoEvent")!;
    expect(event.patch).toMatchObject({ kind: "deleted", todoId: "t1" });
    expect(JSON.parse((event.patch as { payload: string }).payload)).toEqual({
      v: 1,
      title: "Buy milk",
    });

    const tombstone = entries.find((e) => e.kind === "todo" && e.entityId === "t1")!;
    expect(tombstone.patch).toMatchObject({ deletedAt: expect.any(String) });
  });

  it("truncates the title snapshot at 200 characters", () => {
    const entries = buildDeleteTodoEntry(fakeContext(), "t1", { ...input, title: "x".repeat(500) });
    const event = entries.find((e) => e.kind === "todoEvent")!;
    const payload = JSON.parse((event.patch as { payload: string }).payload);

    expect(payload.title).toHaveLength(200);
  });

  it("a childless, attachment-less todo is still two entries — event plus tombstone", () => {
    const entries = buildDeleteTodoEntry(fakeContext(), "t1", {
      title: "Solo",
      childIds: [],
      attachmentIds: [],
    });

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.kind)).toEqual(["todoEvent", "todo"]);
  });

  it("every entry gets its own HLC stamp", () => {
    const entries = buildDeleteTodoEntry(fakeContext(), "t1", input);
    expect(new Set(entries.map((e) => e.hlc)).size).toBe(entries.length);
  });

  it("the whole batch survives the real push pipeline unrejected", () => {
    const entries = buildDeleteTodoEntry(fakeContext(), "t1", input);

    const { accepted, rejected } = validateEntries(entries);
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(5);

    // `deletedAt` must survive `sanitizePatch` — if it were SERVER_ONLY the
    // whole route would silently no-op.
    const todoGroup = groupByEntity(accepted).find(
      (g) => g.kind === "todo" && g.entityId === "t1",
    )!;
    expect(resolveEntityPush({}, todoGroup).apply.deletedAt).toEqual(expect.any(String));
  });
});

describe("deleteTodo (server adapter)", () => {
  it("hands the ENTIRE batch to the transport in ONE call", async () => {
    // One `push()` means one `transactionSync` in the DO. Splitting it could
    // leave children orphaned with the parent still standing.
    const response: PushResponse = { acked: [], rejected: [], highestVersion: 1, conflicts: [] };
    const push = vi.fn<PushTransport>().mockResolvedValue(response);

    await deleteTodo(fakeContext(), "t1", { title: "T", childIds: ["c1"], attachmentIds: ["a1"] }, push);

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toHaveLength(4);
  });
});

// Sanity check that the doc-comment example in todos.ts's header actually
// type-checks against the real wire constant, not just prose.
void SYNC_PROTOCOL_VERSION;
