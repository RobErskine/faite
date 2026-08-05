"use client";

import { useSyncExternalStore } from "react";
import { DARK_CLASS } from "./theme";

/**
 * The palette currently on screen, read off the DOM.
 *
 * The <html> class is the source of truth — the pre-paint script in the root
 * layout writes it before React exists, and Board keeps it current. Anything
 * that needs to KNOW the resolved theme (rather than just be styled by it)
 * subscribes here rather than duplicating the settings read, which is what
 * keeps the Toaster mountable in the root layout where IndexedDB is not
 * available.
 */
export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, snapshot, () => "light" as const);
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

const snapshot = (): "light" | "dark" =>
  document.documentElement.classList.contains(DARK_CLASS) ? "dark" : "light";
