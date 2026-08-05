/**
 * Dismissal state for the two logged-out nudges that aren't always-on (the
 * welcome dialog and the "this device only" banner — the header's Sign up CTA
 * has no dismissal at all, see app-header.tsx).
 *
 * Deliberately separate from `lib/store/owner.ts`: owner.ts resolves *identity*
 * (which account this device's data belongs to) and is permanent by nature.
 * This only remembers what a visitor has already dismissed, which is why the
 * two flags below don't share a storage tier — see each function's comment.
 *
 * Same localStorage-with-try/catch discipline as owner.ts and the pre-paint
 * scripts in layout.tsx: privacy modes throw on any access, and a nudge that
 * reappears once is a much smaller failure than a page that crashes.
 */

const WELCOME_DIALOG_DISMISSED_KEY = "faite:welcome-dialog-dismissed";
const BANNER_DISMISSED_KEY = "faite:banner-dismissed";

function safeGet(storage: Storage | undefined, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage | undefined, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Nudge may reappear next time. Not worth failing the interaction over.
  }
}

/**
 * Permanent, once dismissed — `localStorage`. The welcome dialog is an
 * explanation, not a warning; there is nothing to re-surface once read.
 */
export function isWelcomeDialogDismissed(): boolean {
  return (
    safeGet(
      typeof localStorage === "undefined" ? undefined : localStorage,
      WELCOME_DIALOG_DISMISSED_KEY,
    ) === "1"
  );
}

export function dismissWelcomeDialog(): void {
  safeSet(
    typeof localStorage === "undefined" ? undefined : localStorage,
    WELCOME_DIALOG_DISMISSED_KEY,
    "1",
  );
}

/**
 * Per-session only — `sessionStorage`. Unlike the dialog, the banner is a
 * standing warning ("this device's data isn't backed up"), and it stays true
 * every time a logged-out visitor returns. Dismissing it should quiet the
 * current visit, not silence a real warning forever.
 */
export function isBannerDismissed(): boolean {
  return (
    safeGet(
      typeof sessionStorage === "undefined" ? undefined : sessionStorage,
      BANNER_DISMISSED_KEY,
    ) === "1"
  );
}

export function dismissBanner(): void {
  safeSet(
    typeof sessionStorage === "undefined" ? undefined : sessionStorage,
    BANNER_DISMISSED_KEY,
    "1",
  );
}
