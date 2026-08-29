import { clearFiredReminders } from "@/components/board/use-reminders";
import { clearSavedViews } from "@/lib/saved-views";
import { clearSyncCursors } from "@/lib/sync/cursor";
import { resetLocalDataForNewOwner } from "./adopt-owner";
import { clearBoundOwnerId } from "./owner";

/**
 * Erase every trace of the signed-in user's board from THIS DEVICE. Local
 * only: the Durable Object is never contacted, and the account keeps its data
 * server-side so a later sign-in pulls the whole board back down.
 *
 * `/board` is ungated on purpose (ARCHITECTURE §2.13) and `/` bounces to it
 * whenever `faite:bound-owner-id` exists (`app/page.tsx`), so until this ran,
 * signing out left the next person on the device looking at the previous
 * user's todos. Sign-out is the one moment we can fix that.
 *
 * ## The order is the whole point
 *
 * A surviving `faite:sync-cursor:*` against an emptied IndexedDB is the worst
 * outcome available here, and it is the quiet one: the next sign-in asks for
 * "everything newer than 47", the server has nothing newer, and the device
 * concludes it is caught up while holding an empty board — **permanently,
 * with no error anywhere.** That is the same silent failure `reset.ts`
 * documents at length, reached by a different road.
 *
 * So the cursors go first, and every synchronous, idempotent `removeItem`
 * runs before the one step that can be interrupted mid-way. Step 4 is a
 * single Dexie `rw` transaction, so it is all-or-nothing by construction.
 *
 * | Crash after | State | Recovers by |
 * |---|---|---|
 * | 1 (cursors) | cursor 0, board intact | next sign-in re-pulls from 0 |
 * | 2 (binding) | unbound, board intact | sibling tabs' engines go inactive; `/` stops bouncing |
 * | 3 (view/reminder keys) | board intact | next call finishes the job |
 * | 4 (Dexie) | empty, no seed | `seedIfEmpty` + `ensureDefaultTab` on the next boot (`hooks.ts`) |
 *
 * There is no ordering that survives a crash with the wipe first, which is
 * why this is not a stylistic preference.
 *
 * ## Call it AFTER `signOut()`
 *
 * Not before. Wiping while the session is still live leaves the mounted sync
 * engine with a cursor of 0 and a valid cookie, and its next tick pulls the
 * entire board straight back down. Once signed out every request 401s into
 * `SyncAuthError` and the engine writes nothing. `app-header.tsx`'s
 * `handleSignOut` owns that sequence.
 */
export async function clearDeviceData(): Promise<void> {
  // 1. Cursors first. See the table above — this is the silent one.
  clearSyncCursors();

  // 2. The binding, which is load-bearing three times over: it stops `/`'s
  //    pre-paint bounce to /board, it drops `getCurrentOwnerId()` back to
  //    LOCAL_OWNER_ID so nothing new is stamped with the ex-user's id, and it
  //    makes every sibling tab's `isActive()` go false on its next tick —
  //    which is what stops another tab re-downloading the board we are about
  //    to delete.
  clearBoundOwnerId();

  // 3. The two local-only content keys no existing helper covers. Both are
  //    user content, not preferences: view names are authored, and the fired
  //    set embeds todo ids.
  clearSavedViews();
  clearFiredReminders();

  // 4. The tables. Reused rather than reimplemented — this is the same wipe
  //    an account switch performs, and a second table list would be one more
  //    place to forget a new table (see TABLES' comment in adopt-owner.ts).
  //    It idempotently repeats steps 1-2 at its end.
  await resetLocalDataForNewOwner();
}
