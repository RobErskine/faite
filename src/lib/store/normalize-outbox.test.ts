// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { isHlc } from "@/lib/sync/hlc-core";
import { getDb, resetDbForTests } from "./db";
import { newId, now } from "./mutate";
import { normalizeOutboxHlcs } from "./normalize-outbox";

beforeEach(async () => {
  localStorage.clear();
  await resetDbForTests();
});

describe("normalizeOutboxHlcs", () => {
  it("rewrites legacy ISO stamps into well-formed HLCs", async () => {
    const db = getDb();
    const entry = {
      id: newId(),
      kind: "todo" as const,
      entityId: newId(),
      patch: { title: "legacy" },
      hlc: new Date(2026, 0, 1).toISOString(),
      createdAt: now(),
    };
    await db.outbox.add(entry);

    const fixed = await normalizeOutboxHlcs();

    expect(fixed).toBe(1);
    const updated = await db.outbox.get(entry.id);
    expect(isHlc(updated!.hlc)).toBe(true);
  });

  it("preserves relative order across normalized legacy entries", async () => {
    const db = getDb();
    const earlier = {
      id: newId(),
      kind: "todo" as const,
      entityId: "row-1",
      patch: { title: "first" },
      hlc: new Date(2026, 0, 1).toISOString(),
      createdAt: now(),
    };
    const later = {
      id: newId(),
      kind: "todo" as const,
      entityId: "row-1",
      patch: { title: "second" },
      hlc: new Date(2026, 0, 2).toISOString(),
      createdAt: now(),
    };
    await db.outbox.bulkAdd([earlier, later]);

    await normalizeOutboxHlcs();

    const [normEarlier, normLater] = await Promise.all([
      db.outbox.get(earlier.id),
      db.outbox.get(later.id),
    ]);
    expect(normEarlier!.hlc < normLater!.hlc).toBe(true);
  });

  it("leaves real HLC stamps untouched", async () => {
    const db = getDb();
    const realHlc = "019fd3c2b66c:0000:ab12";
    const entry = {
      id: newId(),
      kind: "todo" as const,
      entityId: newId(),
      patch: { title: "already fine" },
      hlc: realHlc,
      createdAt: now(),
    };
    await db.outbox.add(entry);

    const fixed = await normalizeOutboxHlcs();

    expect(fixed).toBe(0);
    const updated = await db.outbox.get(entry.id);
    expect(updated!.hlc).toBe(realHlc);
  });

  it("is a no-op on a second run", async () => {
    const db = getDb();
    await db.outbox.add({
      id: newId(),
      kind: "todo" as const,
      entityId: newId(),
      patch: { title: "legacy" },
      hlc: new Date().toISOString(),
      createdAt: now(),
    });

    await normalizeOutboxHlcs();
    const fixedAgain = await normalizeOutboxHlcs();

    expect(fixedAgain).toBe(0);
  });
});
