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
  it("a built create entry survives validateEntries/groupByEntity/resolveEntityPush unrejected", () => {
    // No Durable Object involved — `push.ts`'s pipeline is pure (see its own
    // header comment), which is what makes this a real end-to-end check of
    // "would this actually apply" without standing up a DO in a test.
    const entry = buildCreateTodoEntry(fakeContext(), { title: "Ship the scaffold" });

    const { accepted, rejected } = validateEntries([entry]);
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(1);

    const [group] = groupByEntity(accepted);
    const resolution = resolveEntityPush({}, group);

    expect(resolution.conflicts).toEqual([]);
    expect(resolution.apply).toMatchObject({ title: "Ship the scaffold", status: "open" });
    // ownerId is SERVER_ONLY — never applied from a client-shaped patch, even
    // though the builder set it. Confirms `sanitizePatch` (inside
    // `validateEntries`) strips it exactly like an ordinary client push.
    expect(resolution.apply.ownerId).toBeUndefined();
  });
});

describe("createTodo (server adapter)", () => {
  it("builds one entry and hands it to the injected PushTransport", async () => {
    const response: PushResponse = { acked: ["e1"], rejected: [], highestVersion: 1, conflicts: [] };
    const push = vi.fn<PushTransport>().mockResolvedValue(response);

    const result = await createTodo(fakeContext(), { title: "Delegate this" }, push);

    expect(push).toHaveBeenCalledTimes(1);
    const [entries] = push.mock.calls[0];
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("todo");
    expect(entries[0].patch).toMatchObject({ title: "Delegate this" });
    expect(result).toBe(response);
  });
});

// Sanity check that the doc-comment example in todos.ts's header actually
// type-checks against the real wire constant, not just prose.
void SYNC_PROTOCOL_VERSION;
