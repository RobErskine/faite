import { localEvent } from "@/lib/sync/hlc-core";

/**
 * The server's HLC stamper — a narrow answer to `docs/API.md`'s open
 * question, not a general one.
 *
 * The question: a client write carries an HLC from the device's own clock
 * (`lib/sync/hlc.ts`), but a server-originated write has no device.
 *
 * ## Two persistence modes, one function (A4, EI-229)
 *
 * `persistence` defaults to an in-memory adapter — a plain closure variable,
 * scoped to whichever Worker isolate calls `serverHlcClock()`. That is
 * **valid for CREATES only**: a create targets an entity with no
 * `field_clocks` rows yet, so `resolveEntityPush` has nothing to compare the
 * incoming clock against, and every field is applied unconditionally. This
 * is every EXISTING call site (`src/server/email/ingest.ts`) — unchanged,
 * same signature, same behaviour, because creates never needed the fix.
 *
 * **Server-originated UPDATES need the other mode.** Those DO race a real
 * client clock, and the in-memory adapter resets on every isolate recycle —
 * two isolates (or the same isolate cold-starting twice) can then emit the
 * identical `(phys, counter, "server")` and one update silently loses.
 * `UserDurableObject.nextServerHlc()` closes that hole by passing a
 * `sync_meta`-backed `HlcPersistence`: the DO is single-threaded per user and
 * `ctx.storage.sql.exec` is synchronous, so a read-modify-write of
 * `server_last_hlc` there can never observe two calls interleaved, and the
 * value survives isolate recycling because it's on disk, not in a closure.
 *
 * Do not invent a third mode (docs/SYNC.md's sentinel-HLC warning applies
 * here too: a persistence choice's safety is a claim about what a
 * *comparison* can observe, not about the value alone) — every future
 * server-originated write, create or update, should go through one of these
 * two adapters.
 *
 * @param nodeId kept as a parameter so a real per-instance id can be passed
 *   in when one exists, without changing any call site's shape.
 */
export interface HlcPersistence {
  /** The last HLC this stamper issued, or `null` if it never has. */
  load(): string | null;
  /** Records the HLC just issued as the new "last". */
  save(hlc: string): void;
}

function inMemoryHlcPersistence(): HlcPersistence {
  let last: string | null = null;
  return {
    load: () => last,
    save: (hlc) => {
      last = hlc;
    },
  };
}

export function serverHlcClock(
  nodeId = "server",
  persistence: HlcPersistence = inMemoryHlcPersistence(),
): () => string {
  return () => {
    const next = localEvent(persistence.load(), Date.now(), nodeId);
    persistence.save(next);
    return next;
  };
}
