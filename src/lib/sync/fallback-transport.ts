import type { SyncTransport } from "./transport";
import type { PullResponse, PushRequest, PushResponse } from "./wire";

/**
 * Routes each sync call to the WebSocket transport when it is connected, and
 * to HTTP otherwise.
 *
 * This is the whole of P4's "transport swap": `createSyncEngine`'s signature
 * is unchanged, `runSyncCycle` is unchanged, and `SyncTransport` stays the
 * same two methods it has always been. The engine cannot tell which pipe its
 * bytes went down, which is exactly the property that makes the polling
 * fallback free rather than a parallel implementation.
 *
 * **Routing is per CALL, not per cycle.** That looks alarming — a cycle can
 * push over a socket and then pull over HTTP if the socket dies in between —
 * but `runSyncCycle` is already built for exactly that:
 *
 *   - a failing push records the error and still runs the pull, so the two
 *     directions are independent by construction;
 *   - the pull loop carries `cursor` in a local and calls `setCursor` once
 *     per page, so switching transports mid-`hasMore` loop resumes from the
 *     right place rather than restarting or skipping;
 *   - the merge is per-field LWW and acks delete by explicit id, so the
 *     worst case of a mid-cycle switch is a repeated round trip, never a
 *     lost or duplicated write.
 *
 * Per-cycle routing would buy nothing and would need a policy for "the
 * socket died halfway", which is the case this design simply doesn't have.
 */
export function createFallbackTransport(
  primary: SyncTransport,
  fallback: SyncTransport,
  isPrimaryReady: () => boolean,
): SyncTransport {
  return {
    push(request: PushRequest): Promise<PushResponse> {
      return isPrimaryReady() ? primary.push(request) : fallback.push(request);
    },
    pull(cursor: number, limit: number): Promise<PullResponse> {
      return isPrimaryReady() ? primary.pull(cursor, limit) : fallback.pull(cursor, limit);
    },
  };
}
