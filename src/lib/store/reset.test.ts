// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSyncCursor, setSyncCursor } from "@/lib/sync/cursor";
import { getDb, resetDbForTests } from "./db";
import { getBoundOwnerId } from "./owner";
import { createTodo, getBacklog, LOCAL_OWNER_ID, seedIfEmpty } from "./repositories";
import { resetAccountData } from "./reset";

/**
 * `resetAccountData` is the ONLY supported way to reset an account, because
 * it is the only thing that clears the pull cursor before the server is
 * wiped. Everything else about a reset is recoverable; getting that order
 * wrong is the silent, board-wide sync death `docs/SCHEMA-OPS.md` describes.
 *
 * So these tests are mostly about ORDER and about what survives, not about
 * whether rows disappear.
 */

const OWNER = "real-user-1";

/** Records the sequence of side effects so ordering can be asserted. */
let calls: string[];

beforeEach(async () => {
  localStorage.clear();
  await resetDbForTests();
  calls = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(`fetch:${url}`);
      // Capture whether the cursor was still set at the moment the server
      // was asked to wipe — the whole point of the ordering.
      if (url.includes("/api/sync/reset")) {
        calls.push(`cursor-at-wipe:${getSyncCursor(OWNER)}`);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resetAccountData", () => {
  it("clears the pull cursor BEFORE asking the server to wipe", async () => {
    await seedIfEmpty();
    setSyncCursor(OWNER, 42);

    await resetAccountData(OWNER);

    // The assertion that matters. If the wipe happened first, this would read
    // 42 — and a crash at that instant would strand every device above the
    // server's reset counter.
    expect(calls).toContain("cursor-at-wipe:0");
    expect(getSyncCursor(OWNER)).toBe(0);
  });

  it("empties the local store and reseeds a usable board", async () => {
    await seedIfEmpty();
    await createTodo({ title: "Buy milk" });
    expect(await getDb().todos.count()).toBe(1);

    await resetAccountData(OWNER);

    expect(await getDb().todos.count()).toBe(0);
    // Reseeded, not merely emptied: a board with no Backlog and no default
    // tab is not a working board (`buildBoard` sends homeless todos to
    // Backlog, so it has to exist).
    expect(await getBacklog()).toBeDefined();
    expect(await getDb().tabs.count()).toBeGreaterThan(0);
  });

  it("re-binds the reseeded rows to the real account", async () => {
    await seedIfEmpty();
    await resetAccountData(OWNER);

    expect(getBoundOwnerId()).toBe(OWNER);
    const lists = await getDb().lists.toArray();
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((list) => list.ownerId === OWNER)).toBe(true);
  });

  it("leaves settings keyed to LOCAL_OWNER_ID, as everywhere else", async () => {
    await seedIfEmpty();
    await resetAccountData(OWNER);

    // Settings' Dexie primary key IS `ownerId`, hardcoded app-wide — see
    // ARCHITECTURE §2.12. A reset must not be the one path that re-keys it.
    const settings = await getDb().settings.get(LOCAL_OWNER_ID);
    expect(settings?.ownerId).toBe(LOCAL_OWNER_ID);
  });

  it("never calls the server when signed out, and still resets locally", async () => {
    await seedIfEmpty();
    await createTodo({ title: "Buy milk" });

    // §2.13: the board is deliberately usable with no account. A signed-out
    // user has no Durable Object at all, so a local reset is the whole
    // operation — not a degraded one.
    await resetAccountData(null);

    expect(calls.filter((c) => c.startsWith("fetch:"))).toEqual([]);
    expect(await getDb().todos.count()).toBe(0);
    expect(await getBacklog()).toBeDefined();
  });

  it("still resets locally when the session expired mid-reset", async () => {
    await seedIfEmpty();
    await createTodo({ title: "Buy milk" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 })),
    );

    // A 401 means there was nothing we were allowed to wipe. Failing the
    // whole reset over it would leave the user with the board they just
    // asked to throw away.
    await expect(resetAccountData(OWNER)).resolves.toBeUndefined();
    expect(await getDb().todos.count()).toBe(0);
  });

  it("propagates a real server failure instead of silently diverging", async () => {
    await seedIfEmpty();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );

    // The opposite of the 401 case: the server may still hold the old
    // schema's rows. Reseeding locally on top of that is exactly the
    // divergence this function exists to prevent, so it must throw.
    await expect(resetAccountData(OWNER)).rejects.toThrow();
  });
});
