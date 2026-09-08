import { describe, expect, it } from "vitest";
import { encodeHlc } from "@/lib/sync/hlc-core";
import type { ServiceContext } from "./context";
import {
  buildCreateDayNoteEntry,
  buildCreateLabelEntry,
  buildCreateListEntry,
  buildCreateTabEntry,
  buildDeleteEntry,
  buildUpdateDayNoteEntry,
  buildUpdateLabelEntry,
  buildUpdateListEntry,
  buildUpdateTabEntry,
  dayNoteIdFor,
} from "./entities";

function fakeContext(): ServiceContext {
  let counter = 0;
  return {
    userId: "user-1",
    nextHlc: () => encodeHlc({ phys: 5000, counter: counter++, nodeId: "test-node" }),
  };
}

describe("create builders produce one fully-defaulted entry", () => {
  it("list", () => {
    const [entry] = buildCreateListEntry(fakeContext(), { name: "Errands", position: "a1" });

    expect(entry.kind).toBe("list");
    expect(entry.patch).toMatchObject({
      name: "Errands",
      position: "a1",
      ownerId: "user-1",
      isBacklog: false,
      archivedAt: null,
      archivedWithTabId: null,
      tabId: null,
      description: null,
      color: null,
      deletedAt: null,
    });
  });

  it("label", () => {
    const [entry] = buildCreateLabelEntry(fakeContext(), {
      name: "Urgent",
      position: "a1",
      color: "red",
    });

    expect(entry.kind).toBe("label");
    expect(entry.patch).toMatchObject({ name: "Urgent", color: "red", emoji: null });
  });

  it("tab", () => {
    const [entry] = buildCreateTabEntry(fakeContext(), { name: "Work", position: "a1" });

    expect(entry.kind).toBe("tab");
    expect(entry.patch).toMatchObject({ name: "Work", isDefault: false, archivedAt: null });
  });

  it("day note — id is derived from the date, not random", () => {
    const [entry] = buildCreateDayNoteEntry(fakeContext(), "2026-09-08", "# hello");

    expect(entry.kind).toBe("dayNote");
    expect(entry.entityId).toBe("daynote:2026-09-08");
    expect(entry.patch).toMatchObject({ date: "2026-09-08", body: "# hello" });
  });

  it("every create is exactly one entry — none of these kinds has a journal", () => {
    const ctx = fakeContext();
    expect(buildCreateListEntry(ctx, { name: "L", position: "a1" })).toHaveLength(1);
    expect(buildCreateLabelEntry(ctx, { name: "L", position: "a1" })).toHaveLength(1);
    expect(buildCreateTabEntry(ctx, { name: "T", position: "a1" })).toHaveLength(1);
    expect(buildCreateDayNoteEntry(ctx, "2026-09-08", "x")).toHaveLength(1);
  });
});

/**
 * REGRESSION — the reason this module is generic at all.
 *
 * Every field on these schemas carries a Zod `.default()`, and `.default()`
 * fires for any key the parser considers ABSENT. A static
 * `schema.partial().parse({ name })` therefore returns EVERY field at its
 * default. `buildUpdate`'s dynamic pick-from-present-keys mask is what stops
 * that, and these assert it — once per kind, because a regression would
 * plausibly be introduced one kind at a time.
 *
 * `isBacklog` is the worst case in the codebase: reset to `false` on the
 * Backlog list, the account has no backlog, `deleteList`'s guard never fires
 * again, and homeless todos have nowhere to land.
 */
describe("update builders never expand a sparse patch to schema defaults", () => {
  it("a list rename touches name + updatedAt, and nothing else", () => {
    const [entry] = buildUpdateListEntry(fakeContext(), "list-1", { name: "Renamed" });

    expect(Object.keys(entry.patch).sort()).toEqual(["name", "updatedAt"]);
    expect(entry.patch).not.toHaveProperty("isBacklog");
    expect(entry.patch).not.toHaveProperty("archivedWithTabId");
    expect(entry.entityId).toBe("list-1");
  });

  it("a tab rename does not reset isDefault", () => {
    const [entry] = buildUpdateTabEntry(fakeContext(), "tab-1", { name: "Renamed" });

    expect(Object.keys(entry.patch).sort()).toEqual(["name", "updatedAt"]);
    expect(entry.patch).not.toHaveProperty("isDefault");
  });

  it("a label recolor does not clear its emoji", () => {
    const [entry] = buildUpdateLabelEntry(fakeContext(), "label-1", { color: "blue" });

    expect(Object.keys(entry.patch).sort()).toEqual(["color", "updatedAt"]);
    expect(entry.patch).not.toHaveProperty("emoji");
  });

  it("a day-note body write does not reset its date", () => {
    const [entry] = buildUpdateDayNoteEntry(fakeContext(), "2026-09-08", { body: "new" });

    expect(Object.keys(entry.patch).sort()).toEqual(["body", "updatedAt"]);
    expect(entry.patch).not.toHaveProperty("date");
    expect(entry.entityId).toBe(dayNoteIdFor("2026-09-08"));
  });

  it("stamps updatedAt, which mutate() does on every client write", () => {
    const [entry] = buildUpdateListEntry(fakeContext(), "list-1", { name: "Renamed" });
    expect(typeof (entry.patch as { updatedAt: unknown }).updatedAt).toBe("string");
  });

  it("rejects an empty patch — an empty patch is never a valid update", () => {
    expect(() => buildUpdateListEntry(fakeContext(), "list-1", {})).toThrow(/empty patch/);
  });

  it("still validates VALUES against the real schema", () => {
    // The dynamic mask narrows WHICH fields are checked, never whether they are.
    expect(() =>
      buildUpdateListEntry(fakeContext(), "list-1", { name: "" as string }),
    ).toThrow();
  });
});

describe("buildDeleteEntry", () => {
  it("is a tombstone patch, never a row removal", () => {
    const [entry] = buildDeleteEntry(fakeContext(), "list", "list-1");

    expect(entry.kind).toBe("list");
    expect(entry.entityId).toBe("list-1");
    expect(Object.keys(entry.patch).sort()).toEqual(["deletedAt", "updatedAt"]);
    expect((entry.patch as { deletedAt: string }).deletedAt).toEqual(expect.any(String));
  });
});

describe("dayNoteIdFor", () => {
  it("hand-mirrors repositories.ts's dayNoteId", () => {
    expect(dayNoteIdFor("2026-01-31")).toBe("daynote:2026-01-31");
  });
});
