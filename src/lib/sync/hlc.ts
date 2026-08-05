/**
 * Hybrid Logical Clock — P3's ordering primitive.
 *
 * Encoded as a lexicographically sortable string, `<phys>:<counter>:<nodeId>`,
 * so `compareHlc` is plain string comparison — no parsing on the hot path,
 * and it sorts correctly as-is in an IndexedDB index or a SQLite column.
 * `phys` and `counter` are zero-padded fixed-width hex so string order agrees
 * with numeric order at every field boundary; `nodeId` only has to break ties
 * once `phys` and `counter` are equal, so plain string comparison is enough
 * for it regardless of length.
 *
 * See `docs/ARCHITECTURE.md` §7 and Linear EI-47.
 */

export interface HlcParts {
  /** Epoch milliseconds. Up to 48 bits — good past the year 10889. */
  phys: number;
  /** Logical tick within the same `phys` millisecond. Up to 16 bits. */
  counter: number;
  nodeId: string;
}

const PHYS_HEX_WIDTH = 12; // 48 bits
const COUNTER_HEX_WIDTH = 4; // 16 bits
const MAX_COUNTER = 0xffff;

export function encodeHlc({ phys, counter, nodeId }: HlcParts): string {
  return `${phys.toString(16).padStart(PHYS_HEX_WIDTH, "0")}:${counter
    .toString(16)
    .padStart(COUNTER_HEX_WIDTH, "0")}:${nodeId}`;
}

export function decodeHlc(s: string): HlcParts {
  const [physHex, counterHex, nodeId] = s.split(":");
  return { phys: parseInt(physHex, 16), counter: parseInt(counterHex, 16), nodeId };
}

/**
 * Counter overflow pushes `phys` forward by 1ms instead of wrapping.
 * Wrapping the counter back to 0 while `phys` stays put would let a later
 * event sort *before* an earlier one at the same millisecond.
 */
function bumpWithOverflow(phys: number, counter: number): { phys: number; counter: number } {
  if (counter > MAX_COUNTER) {
    return { phys: phys + 1, counter: 0 };
  }
  return { phys, counter };
}

/**
 * Stamp a locally-originated mutation.
 *
 * `last` is the last HLC this node issued (or received), if any.
 */
export function localEvent(last: string | null, wallClock: number, nodeId: string): string {
  if (last === null) {
    return encodeHlc({ phys: wallClock, counter: 0, nodeId });
  }
  const decoded = decodeHlc(last);
  const phys = Math.max(decoded.phys, wallClock);
  const counter = phys === decoded.phys ? decoded.counter + 1 : 0;
  return encodeHlc({ ...bumpWithOverflow(phys, counter), nodeId });
}

/**
 * Merge in a remote HLC on receipt (the standard HLC receive rule).
 *
 * `phys` becomes the max of all three physical times. `counter` derives from
 * whichever of `last`/`remote` actually tied for that max — both if they tie
 * with each other too — and resets to 0 if the wall clock alone won (neither
 * `last` nor `remote` was already at the new max).
 */
export function receiveEvent(
  last: string | null,
  remote: string,
  wallClock: number,
  nodeId: string,
): string {
  const decodedLast = last === null ? null : decodeHlc(last);
  const decodedRemote = decodeHlc(remote);
  const lastPhys = decodedLast?.phys ?? -1;
  const lastCounter = decodedLast?.counter ?? 0;

  const phys = Math.max(lastPhys, decodedRemote.phys, wallClock);

  let counter: number;
  const lastTied = phys === lastPhys;
  const remoteTied = phys === decodedRemote.phys;
  if (lastTied && remoteTied) {
    counter = Math.max(lastCounter, decodedRemote.counter) + 1;
  } else if (lastTied) {
    counter = lastCounter + 1;
  } else if (remoteTied) {
    counter = decodedRemote.counter + 1;
  } else {
    counter = 0;
  }

  return encodeHlc({ ...bumpWithOverflow(phys, counter), nodeId });
}

export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

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
