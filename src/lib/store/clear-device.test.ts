// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSyncCursor, setSyncCursor } from "@/lib/sync/cursor";
import { clearDeviceData } from "./clear-device";
import { getDb, resetDbForTests } from "./db";
import { getBoundOwnerId, setBoundOwnerId } from "./owner";
import { createTodo, seedIfEmpty } from "./repositories";

/**
 * Sign-out is the one destructive path that must be LOCAL ONLY, and the one
 * whose failure mode is silent. So these tests are about three things, in
 * descending order of how quietly they would break:
 *
 *  1. the cursor is gone before the tables are (a surviving cursor against an
 *     empty database leaves the next sign-in permanently half-empty),
 *  2. the device-scoped keys that must SURVIVE actually do,
 *  3. nothing touches the network.
 */

const OWNER = "real-user-1";

/** Every key this must leave alone, with a value we can recognise. */
const KEPT = {
  "faite:last-hlc": "2026-08-29T00:00:00.000Z-0000-node",
  "faite:node-id": "node-abc",
  "faite:theme": "dark",
  "faite:font": "mono",
  "faite:welcome-dialog-dismissed": "1",
  "faite:banner-dismissed": "1",
  "faite:outbox-hlc-normalized:v1": "1",
};

beforeEach(async () => {
  localStorage.clear();
  await resetDbForTests();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function signedInDeviceWithABoard(): Promise<void> {
  await seedIfEmpty();
  await createTodo({ title: "Buy milk" });
  setBoundOwnerId(OWNER);
  setSyncCursor(OWNER, 47);
  localStorage.setItem("faite:saved-views", JSON.stringify([{ name: "Focus mode" }]));
  localStorage.setItem("faite:reminders-fired", JSON.stringify(["todo-1:2026-08-29"]));
  for (const [key, value] of Object.entries(KEPT)) localStorage.setItem(key, value);
}

describe("clearDeviceData", () => {
  it("empties every table, so the next person on this device sees nothing", async () => {
    await signedInDeviceWithABoard();
    expect(await getDb().todos.count()).toBeGreaterThan(0);

    await clearDeviceData();

    const db = getDb();
    expect(await db.todos.count()).toBe(0);
    expect(await db.lists.count()).toBe(0);
    expect(await db.labels.count()).toBe(0);
    expect(await db.projects.count()).toBe(0);
    expect(await db.tabs.count()).toBe(0);
    expect(await db.dayNotes.count()).toBe(0);
    expect(await db.places.count()).toBe(0);
    expect(await db.todoEvents.count()).toBe(0);
    expect(await db.reminderPresets.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
    // Display name and avatar live here.
    expect(await db.settings.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("clears the owner binding, the cursor, and both local-only content keys", async () => {
    await signedInDeviceWithABoard();

    await clearDeviceData();

    // Without this, `/` keeps bouncing to /board and new rows keep being
    // stamped with the ex-user's id.
    expect(getBoundOwnerId()).toBeNull();
    expect(getSyncCursor(OWNER)).toBe(0);
    expect(localStorage.getItem("faite:saved-views")).toBeNull();
    expect(localStorage.getItem("faite:reminders-fired")).toBeNull();
  });

  it("REGRESSION: keeps the device-scoped keys a blanket wipe would take", async () => {
    await signedInDeviceWithABoard();

    await clearDeviceData();

    // `last-hlc` and `node-id` are the dangerous two: restarting the clock
    // risks losing a future LWW comparison against a row this device already
    // pushed, and the node id is what `planDrain` uses to recognise its own
    // entries. `theme`/`font` are read pre-paint by layout.tsx, so clearing
    // them is a visible wrong-theme flash for the next person.
    for (const [key, value] of Object.entries(KEPT)) {
      expect(localStorage.getItem(key), key).toBe(value);
    }
  });

  it("clears the cursor BEFORE it empties the tables", async () => {
    await signedInDeviceWithABoard();

    // The tables are emptied in one Dexie transaction; hooking any table's
    // delete tells us the cursor's state at the instant the wipe began.
    let cursorAtWipe: number | null = null;
    const db = getDb();
    const realClear = db.todos.clear.bind(db.todos);
    // Not `async` — Dexie's `clear()` returns its own `PromiseExtended`, and
    // wrapping it in a native promise fails the signature.
    vi.spyOn(db.todos, "clear").mockImplementation(() => {
      cursorAtWipe ??= getSyncCursor(OWNER);
      return realClear();
    });

    await clearDeviceData();

    // If this read 47, a crash mid-wipe would leave the next sign-in asking
    // `since=47` against an empty board and concluding it was caught up —
    // permanently, with no error anywhere.
    expect(cursorAtWipe).toBe(0);
  });

  it("never touches the network — the Durable Object keeps the account's data", async () => {
    await signedInDeviceWithABoard();

    await clearDeviceData();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("is safe to run twice", async () => {
    await signedInDeviceWithABoard();

    await clearDeviceData();
    await expect(clearDeviceData()).resolves.toBeUndefined();

    expect(getBoundOwnerId()).toBeNull();
    expect(await getDb().todos.count()).toBe(0);
  });
});
