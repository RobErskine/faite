"use client";

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useSession } from "@/lib/auth-client";
import { applyPulledChanges } from "@/lib/store/apply-remote";
import { canUseDb, getDb } from "@/lib/store/db";
import { normalizeOutboxHlcs } from "@/lib/store/normalize-outbox";
import { getBoundOwnerId, getCurrentOwnerId } from "@/lib/store/owner";
import { getSyncCursor, setSyncCursor } from "@/lib/sync/cursor";
import {
  createSyncEngine,
  DEFAULT_INTERVAL_MS,
  LIVE_PUSH_INTERVAL_MS,
  type SyncEngine,
} from "@/lib/sync/engine";
import { createFallbackTransport } from "@/lib/sync/fallback-transport";
import { getNodeId } from "@/lib/sync/hlc";
import { httpTransport } from "@/lib/sync/transport";
import { createWsConnection } from "@/lib/sync/ws-transport";
import { isDesktopShell } from "@/lib/desktop/bridge";

/**
 * Mounts the P3 sync engine (EI-46/EI-48). Renders nothing. Mounted from
 * `Board` next to `SessionProvider`, not `layout.tsx` — same reasoning:
 * sync, like auth, must never become a render dependency (ARCHITECTURE
 * §2.4/§2.12). The board renders from IndexedDB identically whether this
 * component's engine is running, idle, or has never run at all.
 *
 * Also mounted alone by `background-sync/page.tsx` (D2b) — the hidden
 * webview Rust keeps alive while the board window is closed. That window's
 * own JS timers die after one tick (docs/DESKTOP-SYNC-TIMER-SPIKE.md), so
 * `window.__faiteBackgroundSyncTick` below is what a Rust-driven
 * `tokio::time::interval` calls via `eval()` instead. Registered whenever
 * `isDesktopShell()` is true, not just inside the hidden window specifically
 * — harmless in the main window (nothing ever calls it there; Rust only
 * `eval()`s into the background window by label) and keeping one code path
 * simpler than branching on which window this is.
 */
declare global {
  interface Window {
    /** D2b — see this file's doc comment. */
    __faiteBackgroundSyncTick?: () => void;
  }
}

/**
 * The engine belonging to the mounted `SyncProvider`, if any.
 *
 * Module-level rather than a `useRef` so `flushOutbox()` below can reach it
 * from outside React — sign-out (`app-header.tsx`) has to drain the outbox
 * before it deletes the database, and it is nowhere near this component in
 * the tree. Every reader below closes over the binding, not a value, so they
 * see whatever engine exists when they actually fire; that was already true
 * of the ref this replaces.
 *
 * One document's engine. A second tab, or the desktop background window
 * (`background-sync/page.tsx`), each have their own — see `flushOutbox`.
 */
let activeEngine: SyncEngine | null = null;

const FLUSH_TIMEOUT_MS = 10_000;

/**
 * Best-effort: push everything pending, then report what is still stuck.
 *
 * Returns the number of outbox entries that did NOT reach the server, so the
 * caller can decide whether erasing the device would destroy real work — 0
 * means the local board is fully represented server-side and is safe to wipe.
 * Deliberately returns a plain number rather than the engine or an outcome:
 * that keeps every Dexie and sync import out of `app-header.tsx`, whose test
 * file would otherwise need `fake-indexeddb`.
 *
 * Call it while the session cookie is still valid, i.e. BEFORE `signOut()`.
 *
 * `runSync()` bypasses both the `isActive()` gate and the `faite:sync` Web
 * Lock, unlike `notifyRemoteChange()`. That is correct here and only here: we
 * want this cycle now, awaited, whether or not another tab happens to be
 * mid-sync. Cross-account safety comes from `handleSignOut`'s `boundToMe`
 * check, which refuses to flush or wipe at all when this device's board
 * belongs to somebody other than whoever is currently signed in.
 */
export async function flushOutbox(): Promise<number> {
  if (!canUseDb()) return 0;
  if (activeEngine) {
    // `fetch` has no timeout of its own. Without this race a captive portal
    // that accepts the connection and never answers would hang sign-out
    // forever, with the board still on screen and no way out — strictly
    // worse than reporting the entries as unsynced and letting the user
    // confirm.
    await Promise.race([
      activeEngine.runSync(),
      new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
    ]);
  }
  return getDb().outbox.count();
}

export function SyncProvider() {
  const { data: session } = useSession();

  // Reactive, not polled: adopting a device's local rows into a real account
  // (`adoptLocalData`) writes an outbox entry per adopted row, so this fires
  // shortly after sign-in even though nothing here calls adoptLocalData
  // directly. The one gap is a brand-new, empty account signing in for the
  // first time — nothing to adopt, so nothing nudges the engine until its
  // next interval tick (<=30s). Low-severity: there's nothing to sync yet.
  const pendingCount = useLiveQuery(() => getDb().outbox.count(), [], 0);

  useEffect(() => {
    void normalizeOutboxHlcs();
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;
    // NOT "has a session" — SessionProvider's "switch accounts?" dialog
    // shows a session with the OLD board still bound. Gating on the session
    // alone would push that board into the new account's DO while the dialog
    // is still open. Read fresh on every call: `getBoundOwnerId()` is
    // localStorage and flips without a re-render when `adoptLocalData` runs.
    const isActive = () => !!userId && getBoundOwnerId() === userId;

    // Construction order is forced by a cycle: the socket's callbacks need
    // the engine, the engine needs the routing transport, the routing
    // transport needs the socket. `activeEngine` is what breaks it — the
    // callbacks below close over the binding, not over a value, so they read
    // whatever engine exists when they actually fire.
    const connection = createWsConnection({
      isActive,
      onRemoteChange: (version) => {
        // Skip a pull we provably don't need. Sibling tabs share one
        // IndexedDB, so a push from tab A broadcasts to tab B, which already
        // has the data; without this check every push costs a redundant
        // round trip per open tab. `>=` because our cursor being level with
        // the broadcast version means that write is already applied here.
        if (getSyncCursor(getCurrentOwnerId()) >= version) return;
        activeEngine?.notifyRemoteChange();
      },
      // Fires on every connect, reconnect included. Any `changed` sent while
      // we were disconnected went nowhere, so treat "reconnected" as
      // "possibly stale" and reconcile. The persisted cursor makes that a
      // cheap delta rather than a full re-pull.
      onOpen: () => activeEngine?.notifyRemoteChange(),
    });

    const engine = createSyncEngine(
      createFallbackTransport(connection, httpTransport, () => connection.isReady()),
      {
        getPendingOutbox: () => getDb().outbox.toArray(),
        deleteOutboxEntries: async (ids) => {
          if (ids.length > 0) await getDb().outbox.bulkDelete(ids);
        },
        applyPulledChanges,
        getCursor: () => getSyncCursor(getCurrentOwnerId()),
        setCursor: (cursor) => setSyncCursor(getCurrentOwnerId(), cursor),
        getNodeId,
      },
      {
        isActive,
        // Read fresh before every tick. With a socket up, live push catches
        // everything and the interval is only a backstop for a socket that
        // claims to be open and isn't; without one it is still the whole
        // mechanism.
        intervalMs: () => (connection.isReady() ? LIVE_PUSH_INTERVAL_MS : DEFAULT_INTERVAL_MS),
      },
    );

    activeEngine = engine;
    engine.start();
    connection.start();

    if (isDesktopShell()) {
      window.__faiteBackgroundSyncTick = () => {
        activeEngine?.notifyRemoteChange();
      };
    }

    return () => {
      // Socket first: closing it rejects everything in flight, and those
      // rejections should land while the engine is still able to handle
      // them. This effect re-runs on every user-id change, so it is also how
      // the socket gets torn down on sign-out and on an account switch.
      connection.stop();
      engine.stop();
      // Identity-guarded: under StrictMode's double-mount the second effect
      // installs its engine before the first one's cleanup runs, so an
      // unconditional `= null` here would drop a live engine on the floor and
      // leave `flushOutbox()` with nothing to flush.
      if (activeEngine === engine) activeEngine = null;
      if (isDesktopShell()) delete window.__faiteBackgroundSyncTick;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    activeEngine?.notifyLocalChange();
  }, [pendingCount]);

  return null;
}
