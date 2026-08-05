/**
 * Client-facing HLC surface: the pure math from `hlc-core.ts` plus
 * `getNodeId`, the one part of this module that touches `localStorage`. Kept
 * separate so server code can import the pure math without it — see
 * `hlc-core.ts`'s header.
 */
export * from "./hlc-core";

const NODE_ID_KEY = "faite:node-id";

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function randomNodeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Math.random fallback for environments without `crypto` (old WebViews).
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
}

// Memoized in-module so a `localStorage` throw (some privacy modes, per
// owner.ts) still yields one stable id for the life of the page instead of a
// fresh random node id per call — the latter would defeat HLC's per-device
// counter entirely, unlike `ownerId`, which is fine to re-resolve as null.
let cachedNodeId: string | null = null;

/** Stable per-device id. Same accessor pattern as `owner.ts`'s bound owner id. */
export function getNodeId(): string {
  if (cachedNodeId !== null) return cachedNodeId;
  if (!hasLocalStorage()) {
    cachedNodeId = randomNodeId();
    return cachedNodeId;
  }
  try {
    const existing = localStorage.getItem(NODE_ID_KEY);
    if (existing) {
      cachedNodeId = existing;
      return existing;
    }
    const id = randomNodeId();
    localStorage.setItem(NODE_ID_KEY, id);
    cachedNodeId = id;
    return id;
  } catch {
    // Some privacy modes throw on any localStorage access.
    cachedNodeId = randomNodeId();
    return cachedNodeId;
  }
}
