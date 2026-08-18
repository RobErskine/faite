import { localEvent } from "@/lib/sync/hlc-core";

/**
 * The server's HLC stamper — a narrow answer to `docs/API.md`'s open
 * question, not a general one.
 *
 * The question: a client write carries an HLC from the device's own clock
 * (`lib/sync/hlc.ts`), but a server-originated write has no device, and a
 * durable server node id does not exist.
 *
 * **The narrow answer, valid for CREATES only.** A create targets an entity
 * that has no `field_clocks` rows yet, so `resolveEntityPush` has nothing to
 * compare the incoming clock against — every field is applied unconditionally
 * and the stamped HLC becomes the entity's first server clock. Nothing can be
 * lost to an LWW comparison that does not happen, so a wall-clock HLC with a
 * literal `"server"` node id is safe here without any of the durability that
 * a general answer needs.
 *
 * **Server-originated UPDATES are still open.** Those DO race a real client
 * clock, and this clock is per-isolate: it resets whenever the Worker is
 * recycled, so two isolates can issue the same `(phys, counter, "server")`
 * within a millisecond and one update would silently lose. Do not reach for
 * this from an update path until the persisted-node-id question is answered.
 * See `docs/API.md`.
 *
 * @param nodeId kept as a parameter so a real per-instance id can be passed
 *   in when one exists, without changing any call site's shape.
 */
export function serverHlcClock(nodeId = "server"): () => string {
  let last: string | null = null;
  return () => {
    last = localEvent(last, Date.now(), nodeId);
    return last;
  };
}
