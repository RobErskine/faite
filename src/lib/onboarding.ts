/**
 * Dismissal state for the two logged-out nudges that aren't always-on (the
 * welcome dialog and the "this device only" banner — the header's Sign up CTA
 * has no dismissal at all, see app-header.tsx).
 *
 * Deliberately separate from `lib/store/owner.ts`: owner.ts resolves *identity*
 * (which account this device's data belongs to) and is permanent by nature.
 * This only remembers what a visitor has already dismissed. Both flags are
 * permanent per device (`localStorage`): Faite never nags (PRODUCT.md), and a
 * notice that has been read and dismissed once has nothing new to say the
 * next time (EI-376).
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
 * Permanent, once dismissed — `localStorage`, like the dialog (EI-376).
 *
 * This used to be `sessionStorage`, on the theory that "only on this device"
 * stays true every visit and so deserves repeating every visit. In practice
 * that made it the one thing a signed-out visitor had to close every session,
 * stacked under the welcome dialog and the header's Sign up — a funnel, not a
 * notice. The fact does not change between visits, so neither does the
 * answer: read once, dismissed for good. The header's Sign up and the account
 * menu's Sign in stay as the always-available routes to an account.
 *
 * `clearDeviceData()` deliberately leaves this key alone
 * (`clear-device.test.ts`): signing out erases the board, not the visitor's
 * own preferences about this device.
 */
export function isBannerDismissed(): boolean {
  return (
    safeGet(
      typeof localStorage === "undefined" ? undefined : localStorage,
      BANNER_DISMISSED_KEY,
    ) === "1"
  );
}

export function dismissBanner(): void {
  safeSet(
    typeof localStorage === "undefined" ? undefined : localStorage,
    BANNER_DISMISSED_KEY,
    "1",
  );
}
