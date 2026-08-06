// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { isHlc } from "@/lib/sync/hlc-core";
import { SEED_HLC } from "@/lib/sync/wire";
import { getDb, resetDbForTests } from "./db";
import { create, mutate, seedWrite } from "./mutate";

beforeEach(async () => {
  localStorage.clear();
  await resetDbForTests();
});

describe("seedWrite", () => {
  it("stamps the outbox entry at SEED_HLC", async () => {
    await getDb().transaction("rw", getDb().lists, getDb().outbox, async () => {
      await seedWrite({
        kind: "list",
        key: "seed:list:test",
        row: { id: "seed:list:test", name: "Test", position: "a0" },
      });
    });

    const entries = await getDb().outbox.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].hlc).toBe(SEED_HLC);
    expect(isHlc(entries[0].hlc)).toBe(true);
  });

  it(
    "REGRESSION: does not advance faite:last-hlc — folding a seed into this device's " +
      "HLC chain would make a later real edit's clock depend on when the device happened to seed",
    async () => {
      const before = localStorage.getItem("faite:last-hlc");

      await getDb().transaction("rw", getDb().lists, getDb().outbox, async () => {
        await seedWrite({
          kind: "list",
          key: "seed:list:test",
          row: { id: "seed:list:test", name: "Test", position: "a0" },
        });
      });

      expect(localStorage.getItem("faite:last-hlc")).toBe(before);

      // A subsequent real mutation still produces a real, well-formed HLC —
      // unaffected by the seed write that came before it.
      await create("list", { id: "list-1", name: "Real list", position: "a1" });
      const realEntry = (await getDb().outbox.toArray()).find((e) => e.entityId === "list-1")!;
      expect(isHlc(realEntry.hlc)).toBe(true);
      expect(realEntry.hlc).not.toBe(SEED_HLC);
    },
  );

  it("put is idempotent — a re-entrant seed with the same deterministic id upserts, not duplicates", async () => {
    const write = () =>
      getDb().transaction("rw", getDb().lists, getDb().outbox, async () => {
        await seedWrite({
          kind: "list",
          key: "seed:list:test",
          row: { id: "seed:list:test", name: "Test", position: "a0" },
        });
      });

    await write();
    await write();

    expect(await getDb().lists.count()).toBe(1);
    // Each call does still append its own outbox entry — seedWrite itself has
    // no re-entrancy guard; that's seedIfEmpty's emptiness check's job.
    expect(await getDb().outbox.count()).toBe(2);
  });

  it("mutate() after a seed still works normally", async () => {
    await getDb().transaction("rw", getDb().lists, getDb().outbox, async () => {
      await seedWrite({
        kind: "list",
        key: "seed:list:test",
        row: { id: "seed:list:test", name: "Test", position: "a0" },
      });
    });

    await mutate("list", "seed:list:test", { name: "Renamed" });

    const row = await getDb().lists.get("seed:list:test");
    expect(row?.name).toBe("Renamed");
    const updateEntry = (await getDb().outbox.toArray()).find(
      (e) => e.entityId === "seed:list:test" && e.patch.name === "Renamed",
    );
    expect(updateEntry).toBeDefined();
    expect(updateEntry?.hlc).not.toBe(SEED_HLC);
  });
});
