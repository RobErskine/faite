/**
 * The decision layer for the attachment orphan sweep (EI-245).
 *
 * Pure, and separate from `user-do.ts`, for the same reason `planMigrations`
 * and `chunkForInClause` are: the Durable Object cannot be unit-tested here
 * (`@cloudflare/vitest-pool-workers` is banned — see `docs/SYNC.md`), so any
 * rule worth asserting has to live somewhere a test can reach without
 * SQLite, R2, or an alarm.
 *
 * What is left in the DO is the mechanical part — run the query, call
 * `R2.delete`, stamp `swept_at`. What lives here is every judgement that
 * could be wrong.
 */

/**
 * How long a tombstoned attachment's bytes survive before collection.
 *
 * **This is an undo window, not a tidiness setting**, and it is the reason
 * this constant is worth a test.
 *
 * Deleting a to-do tombstones its attachments and is REVERSIBLE — the board
 * shows an Undo toast, and ⌘Z restores the rows through the ordinary forward
 * write path. A sweep that ran inside that window would delete objects the
 * undo is about to re-reference, producing live rows pointing at nothing:
 * exactly the state EI-242's bytes-first ordering exists to make impossible,
 * arrived at from the other direction.
 *
 * 24h is far beyond the real exposure — undo history is in-memory and dies on
 * reload (`src/lib/undo.ts`) — and the cost of being generous is storage for
 * one extra day.
 */
export const SWEEP_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Objects deleted per alarm. Bounds one alarm's wall clock on an account that
 * just deleted a lot; the remainder drains on the next alarm.
 */
export const SWEEP_BATCH = 100;

/**
 * The `deleted_at` boundary: a tombstone older than this is collectable.
 *
 * Takes `nowMs` rather than reading the clock so the window is testable
 * without waiting a day.
 */
export function sweepCutoff(nowMs: number): string {
  return new Date(nowMs - SWEEP_AFTER_MS).toISOString();
}

/**
 * True when a tombstone is old enough to collect.
 *
 * Exported for tests rather than used by the DO — the real filter is the SQL
 * `deleted_at < ?` comparison, and this is the same rule written where it can
 * be asserted. Both compare ISO-8601 strings, which sort lexicographically in
 * timestamp order precisely because they are zero-padded and UTC.
 */
export function isCollectable(deletedAt: string | null, nowMs: number): boolean {
  if (!deletedAt) return false;
  return deletedAt < sweepCutoff(nowMs);
}

/**
 * Whether to chain another alarm immediately.
 *
 * A full batch means there is probably more; anything short means the queue
 * drained. Without this a bulk delete would collect 100 objects a day.
 */
export function shouldRescheduleImmediately(sweptCount: number): boolean {
  return sweptCount >= SWEEP_BATCH;
}

/**
 * Whether to set an alarm, given whatever is already pending.
 *
 * `setAlarm` OVERWRITES, so calling it unconditionally on every push would
 * shove the sweep permanently into the future on an active account — the one
 * whose deleted files most need collecting. Only ever schedule into empty
 * space.
 */
export function shouldScheduleSweep(existingAlarmAtMs: number | null): boolean {
  return existingAlarmAtMs === null;
}
