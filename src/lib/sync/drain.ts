import type { OutboxEntry } from "@/lib/schema";
import { isHlc, normalizeLegacyHlc } from "./hlc-core";
import { SETTINGS_SYNCED_FIELDS, type PushEntry } from "./wire";

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
   * A settings entry lands here only when its patch is empty after the
   * `SETTINGS_SYNCED_FIELDS` allow-list filter (e.g. an `activeTabId`-only
   * edit) — it can never be acked, so leaving it in the outbox would grow
   * it without bound for no reason. */
  drop: OutboxEntry[];
}

export function planDrain(pending: OutboxEntry[], nodeId: string): DrainPlan {
  const drop: OutboxEntry[] = [];
  const normalized: Array<{ entry: OutboxEntry; hlc: string; patch: Record<string, unknown> }> = [];

  for (const entry of pending) {
    let patch = entry.patch;
    if (entry.kind === "settings") {
      patch = Object.fromEntries(
        Object.entries(patch).filter(([field]) => SETTINGS_SYNCED_FIELDS.has(field)),
      );
      if (Object.keys(patch).length === 0) {
        drop.push(entry);
        continue;
      }
    }
    // Belt-and-braces beyond the one-time `normalizeOutboxHlcs()` migration —
    // a stale tab running pre-Phase-0 code could still enqueue a legacy ISO
    // stamp after that migration has already run in another tab.
    const hlc = isHlc(entry.hlc) ? entry.hlc : normalizeLegacyHlc(entry.hlc, nodeId);
    normalized.push({ entry, hlc, patch });
  }

  normalized.sort((a, b) => {
    if (a.hlc !== b.hlc) return a.hlc < b.hlc ? -1 : 1;
    if (a.entry.createdAt !== b.entry.createdAt) return a.entry.createdAt < b.entry.createdAt ? -1 : 1;
    return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
  });

  const batch: PushEntry[] = normalized.map(({ entry, hlc, patch }) => ({
    id: entry.id,
    kind: entry.kind,
    entityId: entry.entityId,
    patch,
    hlc,
  }));

  return { batch, drop };
}
