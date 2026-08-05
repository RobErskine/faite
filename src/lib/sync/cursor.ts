/**
 * Persists the `since=version` pull watermark. localStorage, matching
 * `faite:last-hlc`/`faite:bound-owner-id`'s convention — a Dexie table would
 * force a `version(2)` bump on `db.ts` for no benefit.
 *
 * Scoped per owner, not global: versions are per-Durable-Object, so reusing
 * one account's watermark against another account's DO would silently skip
 * that account's earliest rows — and unlike most sync bugs, that one isn't
 * recoverable without a manual full resync (`since=0`).
 */

const KEY_PREFIX = "faite:sync-cursor:";

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

/** 0 (i.e. "pull everything") when absent, unparseable, or storage is unavailable. */
export function getSyncCursor(ownerId: string): number {
  if (!hasLocalStorage()) return 0;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + ownerId);
    if (raw === null) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

/**
 * Call only AFTER the local apply transaction for this page has committed —
 * see `apply-remote.ts`. Writing it before would lose whatever the
 * interrupted apply missed on a crash; writing it after just means a re-pull
 * on the next run, which is idempotent.
 */
export function setSyncCursor(ownerId: string, cursor: number): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(KEY_PREFIX + ownerId, String(cursor));
  } catch {
    // Best effort — worst case the next pull re-fetches from an older cursor.
  }
}

/** Called by `resetLocalDataForNewOwner()` on an account switch. Deliberately
 * NOT called on sign-out alone — a returning same-account sign-in should
 * resume from where it left off, not re-pull everything. */
export function clearSyncCursors(): void {
  if (!hasLocalStorage()) return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(KEY_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Best effort.
  }
}
