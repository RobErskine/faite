"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Whether ANY context menu is currently open (EI-284).
 *
 * This exists to answer one question for `computeModalOpen`: should board
 * hotkeys fire right now? Base UI owns focus and Escape inside its own popup,
 * but it does not own ⌘Z — that keydown bubbles to `document`,
 * `react-hotkeys-hook` runs undo, and the board rewrites itself behind a menu
 * whose items still describe the pre-undo card. For the reschedule rows it is
 * worse than confusing: undo can tombstone the row between opening the menu
 * and clicking an item, and `mutate()` throws on a missing row by design.
 *
 * A module-level store rather than state threaded through the tree, because
 * the alternative is a callback prop on every `TodoCard` and `BoardColumn`
 * just so the shell can learn a boolean. `ui/context-menu.tsx`'s root calls
 * `useMenuOpenRegistration` once, so every context menu in the app — including
 * ones added later, by someone who never reads this file — is covered with no
 * wiring at all. Only `board.tsx` subscribes, so an open menu re-renders the
 * shell and nothing else.
 *
 * A COUNT, not a boolean: menus overlap. A submenu opening while its parent is
 * open, or one menu closing as another opens, would each flip a bare boolean
 * to the wrong value. Subscribers are still notified only when the count
 * crosses zero, so those interior transitions cost no renders.
 *
 * No `window`, no `document` — see lessons L78/L1000.
 */

let openCount = 0;
const listeners = new Set<() => void>();

/**
 * Push or pop one open menu. Calls MUST balance; prefer
 * `useMenuOpenRegistration`, which balances them for you and cannot strand the
 * count when a component unmounts mid-menu.
 *
 * Clamped at zero so an unbalanced close can never drive the count negative —
 * which would otherwise leave `useAnyMenuOpen` reporting false while a menu is
 * genuinely open, re-arming ⌘Z behind it. Failing closed here would be the
 * silent version of exactly the bug this module prevents.
 */
export function setMenuOpen(open: boolean): void {
  const wasOpen = openCount > 0;
  openCount = open ? openCount + 1 : Math.max(0, openCount - 1);
  if (wasOpen !== openCount > 0) {
    for (const listener of listeners) listener();
  }
}

/** The raw count. Exported for tests and for assertions in other listeners. */
export function getMenuOpenCount(): number {
  return openCount;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): boolean {
  return openCount > 0;
}

/** Nothing is open during a server render, and nothing can be. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Reports one menu's open state into the store, for the lifetime of one
 * component.
 *
 * Two things it guarantees that a bare `setMenuOpen` cannot. It ignores a
 * repeated report of the state it is already in, so a primitive that fires
 * `onOpenChange(false)` twice on close cannot pop a count it never pushed.
 * And it pops on unmount if it is still open — which is the ordinary case
 * when a menu item deletes the very to-do whose row hosts the menu.
 */
export function useMenuOpenRegistration(): (open: boolean) => void {
  const openRef = useRef(false);

  useEffect(
    () => () => {
      if (openRef.current) {
        openRef.current = false;
        setMenuOpen(false);
      }
    },
    [],
  );

  return useCallback((open: boolean) => {
    if (openRef.current === open) return;
    openRef.current = open;
    setMenuOpen(open);
  }, []);
}

/** Whether any context menu is open. Subscribe from the board shell only. */
export function useAnyMenuOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
