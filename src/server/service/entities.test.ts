import { describe, expect, it, vi } from "vitest";
import { encodeHlc } from "@/lib/sync/hlc-core";
import type { ServiceContext } from "@/lib/service/context";
import {
  buildCreateLabelEntry,
  buildCreateListEntry,
  buildCreateTabEntry,
  buildDeleteEntry,
} from "@/lib/service/entities";
import type { PushResponse } from "@/lib/sync/wire";
import { groupByEntity, resolveEntityPush, validateEntries } from "../sync/push";
import { createList, deleteEntity, updateList } from "./entities";
import type { PushTransport } from "./todos";

function fakeContext(): ServiceContext {
  let counter = 0;
  return {
    userId: "user-1",
    nextHlc: () => encodeHlc({ phys: 5000, counter: counter++, nodeId: "test-node" }),
  };
}

function okResponse(): PushResponse {
  return { acked: [], rejected: [], highestVersion: 1, conflicts: [] };
}

/**
 * The same check `./todos.test.ts` makes, extended to the generic builders.
 * `push.ts`'s pipeline is pure (see its own header), which is what makes this
 * a real "would this actually apply" test with no Durable Object standing up.
 */
describe("generic builders feed the real push pipeline", () => {
  it.each([
    ["list", () => buildCreateListEntry(fakeContext(), { name: "Errands", position: "a1" })],
    ["label", () => buildCreateLabelEntry(fakeContext(), { name: "Urgent", position: "a1" })],
    ["tab", () => buildCreateTabEntry(fakeContext(), { name: "Work", position: "a1" })],
  ])("a built %s create survives validateEntries/groupByEntity/resolveEntityPush", (kind, build) => {
    const entries = build();

    const { accepted, rejected } = validateEntries(entries);
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(1);

    const groups = groupByEntity(accepted);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe(kind);

    const resolution = resolveEntityPush({}, groups[0]);
    expect(resolution.conflicts).toEqual([]);
    expect(resolution.apply).toMatchObject({ name: expect.any(String), position: "a1" });

    // `ownerId` is SERVER_ONLY — stripped by `sanitizePatch` inside
    // `validateEntries`, exactly as it is for an ordinary client push, even
    // though the builder sets it. Same assertion `todos.test.ts` makes.
    expect(resolution.apply.ownerId).toBeUndefined();
  });

  it("a tombstone survives the pipeline with deletedAt intact", () => {
    // `deletedAt` is deliberately NOT in SERVER_ONLY_FIELDS — if it were,
    // every DELETE route would silently no-op.
    const entries = buildDeleteEntry(fakeContext(), "list", "list-1");

    const { accepted, rejected } = validateEntries(entries);
    expect(rejected).toEqual([]);

    const resolution = resolveEntityPush({}, groupByEntity(accepted)[0]);
    expect(resolution.apply.deletedAt).toEqual(expect.any(String));
  });
});

describe("server adapters", () => {
  it("createList pushes once and returns the entity id, not an acked outbox id", async () => {
    const response: PushResponse = { ...okResponse(), acked: ["outbox-1"] };
    const push = vi.fn<PushTransport>().mockResolvedValue(response);

    const { listId } = await createList(fakeContext(), { name: "Errands", position: "a1" }, push);

    expect(push).toHaveBeenCalledTimes(1);
    const [entries] = push.mock.calls[0];
    expect(entries).toHaveLength(1);
    expect(listId).toBe(entries[0].entityId);
    // REGRESSION: `acked` holds outbox ENTRY ids, never the entity id.
    expect(listId).not.toBe("outbox-1");
  });

  it("updateList forwards the sparse patch untouched", async () => {
    const push = vi.fn<PushTransport>().mockResolvedValue(okResponse());

    await updateList(fakeContext(), "list-1", { name: "Renamed" }, push);

    const [entries] = push.mock.calls[0];
    expect(entries[0].entityId).toBe("list-1");
    expect(Object.keys(entries[0].patch).sort()).toEqual(["name", "updatedAt"]);
  });

  it("deleteEntity pushes a tombstone for whichever kind it is given", async () => {
    const push = vi.fn<PushTransport>().mockResolvedValue(okResponse());

    await deleteEntity(fakeContext(), "tab", "tab-1", push);

    const [entries] = push.mock.calls[0];
    expect(entries[0].kind).toBe("tab");
    expect(entries[0].patch).toMatchObject({ deletedAt: expect.any(String) });
  });
});
