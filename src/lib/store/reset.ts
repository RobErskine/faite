import { clearSyncCursors } from "@/lib/sync/cursor";
import { resetRemoteBoard, SyncAuthError } from "@/lib/sync/transport";
import { adoptLocalData, resetLocalDataForNewOwner } from "./adopt-owner";
import { ensureDefaultTab, seedIfEmpty } from "./repositories";

/**
 * Throw away this account's data — locally and on the server — and reseed a
 * fresh board.
 *
 * This is the escape hatch that makes "change the data model, drop the data,
 * start again" a supported operation while Faite has one user, instead of the
 * trap `docs/SYNC.md` documents. See `docs/SCHEMA-OPS.md` for when to reach
 * for it, and for the event that retires it: **a second real account.** You
 * cannot reset data that isn't yours.
 *
 * ## The order is the whole point
 *
 * Wiping the Durable Object resets `sync_meta.next_version` to 1. Any device
 * still holding a `faite:sync-cursor:*` above that value then asks for
 * "everything newer than 42" against a server whose newest row is version 3,
 * gets nothing, and concludes it is caught up — **forever, on every device at
 * once, with no error anywhere.** That is the single worst failure mode in
 * this codebase, because it is completely silent.
 *
 * So the cursor is cleared FIRST, and every intermediate state is survivable:
 *
 * | Crash after | State | Recovers by |
 * |---|---|---|
 * | 1 (cursor cleared) | cursor 0, server intact | next pull re-reads everything; idempotent |
 * | 2 (server wiped) | cursor 0, server empty, local data intact | next push re-uploads the local board |
 * | 3 (local cleared) | both empty, no seed | `seedIfEmpty` on the next boot (`hooks.ts:36`) |
 *
 * There is no ordering that survives a crash with the wipe first, which is
 * why this is not a stylistic preference.
 *
 * ## Reseeding
 *
 * Steps 3–5 are exactly what `session-provider.tsx` already does on the
 * `"different-user"` path, and for the same reason: `resetLocalDataForNewOwner`
 * clears the owner binding, so the seed writes under `LOCAL_OWNER_ID` and
 * needs `adoptLocalData` to re-bind it to the real account. Following that
 * sequence rather than inventing a second one keeps `seedWrite`'s `SEED_HLC`
 * contract intact (`mutate.ts`) — a seed must lose every field to any real
 * edit, and it only does that if it goes through the normal path.
 */
export async function resetAccountData(userId: string | null): Promise<void> {
  // 1. Cursor first. See the table above.
  clearSyncCursors();

  // 2. Server. Skipped when signed out — there is no Durable Object to wipe
  //    (§2.13: the board is deliberately usable with no account), so a local
  //    reset is the whole operation.
  if (userId) {
    try {
      await resetRemoteBoard();
    } catch (error) {
      // A session that expired between the caller's check and this request.
      // Not worth failing the whole reset over: the local half below is still
      // correct and still what the user asked for, and the DO keeps data they
      // can reset later. Anything else is a real failure and must surface —
      // silently continuing would leave the server holding the old schema's
      // rows while the client reseeds, which is exactly the divergence this
      // function exists to prevent.
      if (!(error instanceof SyncAuthError)) throw error;
      console.warn("[faite] reset: not authenticated, resetting locally only");
    }
  }

  // 3. Local store, owner binding, and cursors again (idempotent).
  await resetLocalDataForNewOwner();

  // 4. Fresh board.
  await seedIfEmpty();
  await ensureDefaultTab();

  // 5. Re-bind the seeded rows to the real account, so their first push
  //    carries the right `ownerId` instead of `LOCAL_OWNER_ID`.
  if (userId) await adoptLocalData(userId);
}
