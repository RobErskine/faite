/**
 * Resolves which `ownerId` new local writes should carry.
 *
 * P1 was single-user with no auth, so every row carried this fixed value.
 * P2 (Better Auth) adopts a device's existing rows into a real account on
 * first sign-in — see `adopt-owner.ts` — and from that point on, new writes
 * must carry the real id too, or they would immediately re-orphan themselves
 * back onto the placeholder. `getCurrentOwnerId()` is the one place that
 * decides which applies; `repositories.ts` calls it instead of the constant
 * directly everywhere a new row is created.
 *
 * `settings` is the one exception, and stays hardcoded to `LOCAL_OWNER_ID`
 * forever — see the comment on `adoptLocalData` in `adopt-owner.ts`.
 */
export const LOCAL_OWNER_ID = "local-user";

const BOUND_OWNER_KEY = "faite:bound-owner-id";

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

/** The real user id this device's local data has been adopted into, if any. */
export function getBoundOwnerId(): string | null {
  if (!hasLocalStorage()) return null;
  try {
    return localStorage.getItem(BOUND_OWNER_KEY);
  } catch {
    // Some privacy modes throw on any localStorage access.
    return null;
  }
}

export function setBoundOwnerId(ownerId: string): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(BOUND_OWNER_KEY, ownerId);
  } catch {
    // Adoption already happened; only the "don't repeat it" note is lost, so
    // the next sign-in just re-checks harmlessly.
  }
}

export function clearBoundOwnerId(): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(BOUND_OWNER_KEY);
  } catch {
    // ignore
  }
}

/** New todos/lists/labels/projects/tabs are written under this id. */
export function getCurrentOwnerId(): string {
  return getBoundOwnerId() ?? LOCAL_OWNER_ID;
}
