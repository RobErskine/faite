"use client";

import { useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useSession } from "@/lib/auth-client";
import { applyPulledChanges } from "@/lib/store/apply-remote";
import { getDb } from "@/lib/store/db";
import { normalizeOutboxHlcs } from "@/lib/store/normalize-outbox";
import { getBoundOwnerId, getCurrentOwnerId } from "@/lib/store/owner";
import { getSyncCursor, setSyncCursor } from "@/lib/sync/cursor";
import { createSyncEngine, type SyncEngine } from "@/lib/sync/engine";
import { createFallbackTransport } from "@/lib/sync/fallback-transport";
import { getNodeId } from "@/lib/sync/hlc";
import { httpTransport } from "@/lib/sync/transport";
import { createWsConnection } from "@/lib/sync/ws-transport";

/**
 * Mounts the P3 sync engine (EI-46/EI-48). Renders nothing. Mounted from
 * `Board` next to `SessionProvider`, not `layout.tsx` — same reasoning:
 * sync, like auth, must never become a render dependency (ARCHITECTURE
 * §2.4/§2.12). The board renders from IndexedDB identically whether this
 * component's engine is running, idle, or has never run at all.
 */
export function SyncProvider() {
  const { data: session } = useSession();
  const engineRef = useRef<SyncEngine | null>(null);

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
    // transport needs the socket. `engineRef` is what breaks it — the
    // callbacks below close over the ref, not over a value, so they read
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
        engineRef.current?.notifyRemoteChange();
      },
      // Fires on every connect, reconnect included. Any `changed` sent while
      // we were disconnected went nowhere, so treat "reconnected" as
      // "possibly stale" and reconcile. The persisted cursor makes that a
      // cheap delta rather than a full re-pull.
      onOpen: () => engineRef.current?.notifyRemoteChange(),
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
      { isActive },
    );

    engineRef.current = engine;
    engine.start();
    connection.start();
    return () => {
      // Socket first: closing it rejects everything in flight, and those
      // rejections should land while the engine is still able to handle
      // them. This effect re-runs on every user-id change, so it is also how
      // the socket gets torn down on sign-out and on an account switch.
      connection.stop();
      engine.stop();
      engineRef.current = null;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    engineRef.current?.notifyLocalChange();
  }, [pendingCount]);

  return null;
}
