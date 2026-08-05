import type { OutboxEntry } from "@/lib/schema";
import { isHlc, normalizeLegacyHlc } from "./hlc-core";
import type { PushEntry, SyncKind } from "./wire";

/**
 * Decides what one push cycle sends and what it discards, before any
 * network call. Pure so the ordering and filtering rules are testable
 * without Dexie.
 */

export interface DrainPlan {
  /** Ready to push, sorted by (hlc, createdAt, id) — a genuine total order
   * even when normalized legacy stamps tie (same millisecond, counter 0;
   * `compareHlc` alone returns 0 for those). */
  batch: PushEntry[];
  /** Will never be pushed — delete these locally without a network call.
   * Currently only `kind === "settings"`; P3 doesn't sync it (see
   * docs/SYNC.md's "Known traps") and it can never be acked, so leaving it
   * in the outbox would grow it without bound. */
  drop: OutboxEntry[];
}

export function planDrain(pending: OutboxEntry[], nodeId: string): DrainPlan {
  const drop: OutboxEntry[] = [];
  const normalized: Array<{ entry: OutboxEntry; hlc: string }> = [];

  for (const entry of pending) {
    if (entry.kind === "settings") {
      drop.push(entry);
      continue;
    }
    // Belt-and-braces beyond the one-time `normalizeOutboxHlcs()` migration —
    // a stale tab running pre-Phase-0 code could still enqueue a legacy ISO
    // stamp after that migration has already run in another tab.
    const hlc = isHlc(entry.hlc) ? entry.hlc : normalizeLegacyHlc(entry.hlc, nodeId);
    normalized.push({ entry, hlc });
  }

  normalized.sort((a, b) => {
    if (a.hlc !== b.hlc) return a.hlc < b.hlc ? -1 : 1;
    if (a.entry.createdAt !== b.entry.createdAt) return a.entry.createdAt < b.entry.createdAt ? -1 : 1;
    return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
  });

  const batch: PushEntry[] = normalized.map(({ entry, hlc }) => ({
    id: entry.id,
    // Safe: "settings" was already filtered into `drop` above.
    kind: entry.kind as SyncKind,
    entityId: entry.entityId,
    patch: entry.patch,
    hlc,
  }));

  return { batch, drop };
}
