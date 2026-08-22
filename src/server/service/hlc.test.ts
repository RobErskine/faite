import { describe, expect, it, vi, afterEach } from "vitest";
import { compareHlc, decodeHlc, encodeHlc } from "@/lib/sync/hlc-core";
import type { PushEntry } from "@/lib/sync/wire";
import { groupByEntity, resolveEntityPush, validateEntries } from "../sync/push";
import { serverHlcClock, type HlcPersistence } from "./hlc";

afterEach(() => {
  vi.useRealTimers();
});

/** The exact shape `UserDurableObject.nextServerHlc()` builds, minus the SQL —
 * a plain JS ref stands in for `sync_meta.server_last_hlc` across "isolate
 * recycles" (a fresh `serverHlcClock()` call against the same backing store). */
function fakeSyncMetaPersistence(): HlcPersistence {
  let stored: string | null = null;
  return {
    load: () => stored,
    save: (hlc) => {
      stored = hlc;
    },
  };
}

describe("serverHlcClock", () => {
  it("stamps the node id it was given", () => {
    expect(decodeHlc(serverHlcClock()()).nodeId).toBe("server");
    expect(decodeHlc(serverHlcClock("do-42")()).nodeId).toBe("do-42");
  });

  it("is strictly monotonic across calls inside a single millisecond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));

    const clock = serverHlcClock();
    const stamps = Array.from({ length: 100 }, clock);

    for (let i = 1; i < stamps.length; i++) {
      expect(compareHlc(stamps[i], stamps[i - 1])).toBeGreaterThan(0);
    }
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it("advances with the wall clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const clock = serverHlcClock();
    const first = clock();

    vi.setSystemTime(new Date("2026-08-17T12:00:01.000Z"));
    const second = clock();

    expect(compareHlc(second, first)).toBeGreaterThan(0);
    expect(decodeHlc(second).phys).toBeGreaterThan(decodeHlc(first).phys);
    // Counter resets once physical time moves on.
    expect(decodeHlc(second).counter).toBe(0);
  });

  it("never goes backwards when the wall clock does", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:01.000Z"));
    const clock = serverHlcClock();
    const first = clock();

    // NTP correction, or two isolates disagreeing.
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const second = clock();

    expect(compareHlc(second, first)).toBeGreaterThan(0);
  });

  it("DEFAULT (in-memory) persistence: two independent clocks DO collide — the documented reason it's safe for creates only", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    // Two isolates at the same millisecond, each with its own in-memory
    // adapter (no arguments passed), collide. Unchanged behaviour — every
    // existing caller (src/server/email/ingest.ts) only ever creates, and
    // creates have no field_clocks to lose an LWW comparison against.
    expect(serverHlcClock()()).toBe(serverHlcClock()());
  });

  it("A4/EI-229 FIX: a shared (sync_meta-backed) persistence survives isolate recycling with no collision", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));

    const persistence = fakeSyncMetaPersistence();
    const isolateOne = serverHlcClock("server", persistence)();
    // A fresh `serverHlcClock()` call, same backing store — this is exactly
    // what a Worker isolate recycle looks like from the DO's perspective:
    // the JS closure is gone, but `sync_meta.server_last_hlc` is still on disk.
    const isolateTwo = serverHlcClock("server", persistence)();

    expect(isolateTwo).not.toBe(isolateOne);
    expect(compareHlc(isolateTwo, isolateOne)).toBeGreaterThan(0);
  });

  it("A4/EI-229 FIX: concurrent-looking calls against shared persistence never produce the same stamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));

    const persistence = fakeSyncMetaPersistence();
    // Every call reconstructs the clock from `persistence`, simulating N
    // separate isolates (or the same isolate recycled N times) all trying to
    // stamp a server-originated update at the exact same millisecond.
    const stamps = Array.from({ length: 50 }, () => serverHlcClock("server", persistence)());

    expect(new Set(stamps).size).toBe(stamps.length);
  });
});

describe("a server-stamped update racing a client update (A4, EI-229 — the actual risk this ticket exists to close)", () => {
  const CLIENT_NODE = "device-a";

  function pushOne(entry: PushEntry, existingClocks: Record<string, string>) {
    const { accepted } = validateEntries([entry]);
    const [group] = groupByEntity(accepted);
    return resolveEntityPush(existingClocks, group);
  }

  it("a later server update beats an earlier client update", () => {
    const persistence = fakeSyncMetaPersistence();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const clientHlc = encodeHlc({ phys: Date.now(), counter: 0, nodeId: CLIENT_NODE });

    const first = pushOne(
      { id: "e1", kind: "todo", entityId: "t1", patch: { title: "client wins nothing yet" }, hlc: clientHlc },
      {},
    );
    expect(first.apply).toEqual({ title: "client wins nothing yet" });

    vi.setSystemTime(new Date("2026-08-17T12:00:01.000Z"));
    const serverHlc = serverHlcClock("server", persistence)();
    const second = pushOne(
      { id: "e2", kind: "todo", entityId: "t1", patch: { title: "server, later, wins" }, hlc: serverHlc },
      first.clockUpdates,
    );

    expect(second.apply).toEqual({ title: "server, later, wins" });
    expect(second.conflicts).toEqual([]);
  });

  it("an earlier server update loses to a later client update", () => {
    const persistence = fakeSyncMetaPersistence();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));

    const serverHlc = serverHlcClock("server", persistence)();
    const first = pushOne(
      { id: "e1", kind: "todo", entityId: "t1", patch: { title: "server, first" }, hlc: serverHlc },
      {},
    );
    expect(first.apply).toEqual({ title: "server, first" });

    vi.setSystemTime(new Date("2026-08-17T12:00:01.000Z"));
    const clientHlc = encodeHlc({ phys: Date.now(), counter: 0, nodeId: CLIENT_NODE });
    const second = pushOne(
      { id: "e2", kind: "todo", entityId: "t1", patch: { title: "client, later, wins" }, hlc: clientHlc },
      first.clockUpdates,
    );

    expect(second.apply).toEqual({ title: "client, later, wins" });
    expect(second.conflicts).toEqual([]);
  });
});
