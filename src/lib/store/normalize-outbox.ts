import { isHlc, normalizeLegacyHlc } from "@/lib/sync/hlc-core";
import { getNodeId } from "@/lib/sync/hlc";
import { getDb } from "./db";

/**
 * One-time repair for outbox entries stamped before the HLC swap (or by
 * `adoptLocalData`, before it was fixed to use `mutate.ts`'s real `enqueue`):
 * plain `new Date().toISOString()` strings in the `hlc` column.
 *
 * Those sort lexicographically *greater* than every real HLC, so left alone
 * they would win every field-level LWW comparison forever the moment the
 * outbox is first drained (P3's transport). This must run — and must have
 * run for every device — before that first drain.
 *
 * Idempotent by construction (`isHlc` filters out already-normalized rows),
 * but also gated by a localStorage flag so a normal run does zero table scan
 * work after the first.
 */
const NORMALIZED_FLAG_KEY = "faite:outbox-hlc-normalized:v1";

function alreadyNormalized(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(NORMALIZED_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function markNormalized(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(NORMALIZED_FLAG_KEY, "1");
  } catch {
    // Best effort — worst case this scans (cheaply, it's a no-op) again next run.
  }
}

/** Rewrites every non-conforming outbox `hlc`. Returns the count fixed. */
export async function normalizeOutboxHlcs(): Promise<number> {
  if (alreadyNormalized()) return 0;

  const db = getDb();
  const nodeId = getNodeId();
  let fixed = 0;

  await db.transaction("rw", db.outbox, async () => {
    const entries = await db.outbox.toArray();
    for (const entry of entries) {
      if (isHlc(entry.hlc)) continue;
      await db.outbox.update(entry.id, { hlc: normalizeLegacyHlc(entry.hlc, nodeId) });
      fixed += 1;
    }
  });

  markNormalized();
  return fixed;
}
