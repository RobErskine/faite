"use client";

import { useSyncExternalStore } from "react";
import { detectPlatform, type Platform } from "./keyboard";

/**
 * Display-only platform sniff, client-safe.
 *
 * `Platform` never gates behavior — every keyboard handler checks the actual
 * event's modifiers, and `mod` already resolves to whichever of Ctrl/Meta was
 * pressed. It decides only which glyphs a shortcut hint renders. But
 * `navigator` does not exist during the static export's prerender, so reading
 * it directly would render one string server-side and swap in another on
 * hydration. `useSyncExternalStore` with an explicit server snapshot is the
 * sanctioned way to say "client-only" here — see `useIsLocalDev` in
 * `settings-sheet.tsx`.
 *
 * Extracted (EI-289) after this had been copied into `todo-sheet.tsx`,
 * `command-palette.tsx` and `help-sheet.tsx`, each carrying a comment
 * pointing at one of the others. The card context menu would have been a
 * fourth.
 */

/** Never changes within a page's life — same rationale as `useIsLocalDev`. */
const subscribeToNothing = () => () => {};

export function usePlatform(): Platform {
  return useSyncExternalStore(subscribeToNothing, detectPlatform, () => "other");
}
