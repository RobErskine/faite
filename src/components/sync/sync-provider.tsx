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
import { getNodeId } from "@/lib/sync/hlc";
import { httpTransport } from "@/lib/sync/transport";

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
    const engine = createSyncEngine(
      httpTransport,
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
        // NOT "has a session" — SessionProvider's "switch accounts?" dialog
        // shows a session with the OLD board still bound. Gating on the
        // session alone would push that board into the new account's DO
        // while the dialog is still open.
        isActive: () => !!userId && getBoundOwnerId() === userId,
      },
    );

    engineRef.current = engine;
    engine.start();
    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    engineRef.current?.notifyLocalChange();
  }, [pendingCount]);

  return null;
}
