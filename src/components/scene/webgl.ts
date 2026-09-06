/**
 * EI-272 spike. Cheap WebGL capability probe, run once before we bother
 * importing three.js at all.
 *
 * The fallback this guards is not an edge case: `prefers-reduced-motion` is a
 * house rule here, the flat version is what a screen reader gets, and a
 * homepage that renders nothing on a machine without WebGL is worse than one
 * that never had a canvas. So the flat page is the real page, and the canvas
 * is an enhancement on top of it.
 */
export function canUseWebGL(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
