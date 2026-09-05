/**
 * One implementation of the `prefers-reduced-motion` check — four copies of
 * this same guard used to drift independently (drop animations, Overdrive,
 * the day-track jump, the tab-strip scroll-into-view). Safe to call outside
 * the DOM (SSR, tests without `matchMedia`), where it reads as "no
 * preference" rather than throwing.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
