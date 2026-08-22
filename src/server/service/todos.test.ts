import { describe, expect, it, vi } from "vitest";
import { encodeHlc } from "@/lib/sync/hlc-core";
import type { ServiceContext } from "@/lib/service/context";
import { buildCreateTodoEntry } from "@/lib/service/todos";
import { SYNC_PROTOCOL_VERSION, type PushResponse } from "@/lib/sync/wire";
import { groupByEntity, resolveEntityPush, validateEntries } from "../sync/push";
import { createTodo, type PushTransport } from "./todos";

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

// Sanity check that the doc-comment example in todos.ts's header actually
// type-checks against the real wire constant, not just prose.
void SYNC_PROTOCOL_VERSION;
