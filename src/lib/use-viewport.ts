"use client";

import { useSyncExternalStore } from "react";

/**
 * Which shell a screen gets. Width-based, not pointer-based — a touchscreen
 * laptop should still get the desktop board (see `coarse` below), and a
 * phone with a Bluetooth mouse still has a phone's width. See
 * docs/MOBILE.md.
 */
export type BoardLayout = "phone" | "tablet" | "desktop";

export interface ViewportState {
  layout: BoardLayout;
  /** `pointer: coarse` — touch is the primary pointer. Drives hit-target
   * sizing and dnd-kit sensor tuning, independently of `layout`. */
  coarse: boolean;
  /** `hover: hover` — a real hover state exists. Drives whether a
   * hover-revealed control needs a touch-visible fallback. */
  hover: boolean;
}

/**
 * `< 640`: the two-half board is arithmetically impossible (the mobile
 * plan's Decision 1 — the Backlog rail alone is 218px+padding, and
 * `SPLIT_MIN` is 200px PER HALF). `< 1024`: still cramped, but a resized
 * two-half board fits (verified at iPad-mini portrait, 744px). `>= 1024`:
 * unchanged.
 */
function resolveLayout(width: number): BoardLayout {
  if (width < 640) return "phone";
  if (width < 1024) return "tablet";
  return "desktop";
}

/**
 * Forces a layout class regardless of viewport width — `?layout=phone` (or
 * `tablet`/`desktop`) on any URL. Read once per navigation, not reactively:
 * `/board` is a single client-only route (`ssr:false`), so there is no
 * server round trip to re-derive this from, and a query param a test or
 * developer wants to change is a query param they can reload with. This is
 * what makes the phone shell testable from a desktop browser tab instead of
 * requiring a physical device for every check.
 */
function readLayoutOverride(): BoardLayout | null {
  const raw = new URLSearchParams(window.location.search).get("layout");
  return raw === "phone" || raw === "tablet" || raw === "desktop" ? raw : null;
}

const COARSE_QUERY = "(pointer: coarse)";
const HOVER_QUERY = "(hover: hover)";

// Desktop/fine/hoverable: the safe assumption for anything rendered before
// hydration (marketing pages, the static export's first paint) — matches
// every layout this app ships today outside the mobile work. `/board` is
// `ssr:false`, so this snapshot is never actually shown for the board itself;
// it only has to not crash the server render.
const SERVER_SNAPSHOT: ViewportState = { layout: "desktop", coarse: false, hover: true };

// Module-level, not per-hook-instance: there is exactly one browser viewport,
// so every mounted `useViewport()` call describes the same fact and can share
// one cached object. This is also what keeps `useSyncExternalStore` from
// tearing — it warns (and can loop) if `getSnapshot` returns a new object
// reference on every call with nothing having actually changed.
let cached: ViewportState | null = null;

function getSnapshot(): ViewportState {
  const layout = readLayoutOverride() ?? resolveLayout(window.innerWidth);
  const coarse = window.matchMedia(COARSE_QUERY).matches;
  const hover = window.matchMedia(HOVER_QUERY).matches;
  if (cached && cached.layout === layout && cached.coarse === coarse && cached.hover === hover) {
    return cached;
  }
  cached = { layout, coarse, hover };
  return cached;
}

function subscribe(onChange: () => void): () => void {
  const coarseQuery = window.matchMedia(COARSE_QUERY);
  const hoverQuery = window.matchMedia(HOVER_QUERY);
  window.addEventListener("resize", onChange);
  coarseQuery.addEventListener("change", onChange);
  hoverQuery.addEventListener("change", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    coarseQuery.removeEventListener("change", onChange);
    hoverQuery.removeEventListener("change", onChange);
  };
}

/** The live viewport classification — see `ViewportState`. */
export function useViewport(): ViewportState {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}

// Exported for the pure test in use-viewport.test.ts — `resolveLayout` is the
// one piece of this file with a decision worth locking in independently of
// the DOM (window/matchMedia) the rest of the hook needs.
export { resolveLayout };
