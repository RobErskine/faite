/**
 * Request/response correlation over a single duplex channel.
 *
 * Extracted from `ws-transport.ts` so the interesting half is testable
 * without a socket: this module has no `WebSocket`, no `window`, and no
 * network — it is a map, a timer, and a policy about who rejects what.
 *
 * The policy is the part worth pinning:
 *
 *   - A response with an unknown id is DROPPED, not treated as an error. A
 *     late reply arriving after its own timeout must not blow up an
 *     unrelated in-flight request.
 *   - A timeout rejects that one request AND tells the caller to tear the
 *     channel down (see `onTimeout`). A zombie socket keeps `readyState ===
 *     OPEN` long after a laptop sleeps or a phone changes network, so
 *     treating a timeout as merely a failed call would leave every
 *     subsequent push and pull waiting the full timeout — inside
 *     `runSyncCycle`'s `while (hasMore)` loop, against a 30s interval. That
 *     is a wedged engine, not a fallback.
 *   - `rejectAll` is idempotent and clears the map first, so a reject
 *     handler that synchronously starts a new request cannot see a stale
 *     entry.
 */

export interface PendingRequests<T> {
  /** Registers `id` and returns the promise its response will settle. */
  register(id: string, timeoutMs: number): Promise<T>;
  /** Settles a registered request. Returns false if `id` was unknown. */
  resolve(id: string, value: T): boolean;
  /** Rejects everything in flight — call on close, error, or teardown. */
  rejectAll(reason: Error): void;
  /** In-flight count. Test/diagnostic only. */
  size(): number;
}

export class SyncTimeoutError extends Error {
  constructor(id: string, timeoutMs: number) {
    super(`sync request ${id} timed out after ${timeoutMs}ms`);
    this.name = "SyncTimeoutError";
  }
}

export class SyncSocketClosedError extends Error {
  constructor(detail = "socket closed") {
    super(detail);
    this.name = "SyncSocketClosedError";
  }
}

interface Entry<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * `onTimeout` fires once per timed-out request, after its promise has been
 * rejected. `ws-transport.ts` uses it to close the socket, which is what
 * converts "this call failed" into "stop routing here" — see the header.
 */
export function createPendingRequests<T>(onTimeout: (id: string) => void = () => {}): PendingRequests<T> {
  const entries = new Map<string, Entry<T>>();

  function drop(id: string): Entry<T> | undefined {
    const entry = entries.get(id);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    entries.delete(id);
    return entry;
  }

  return {
    register(id: string, timeoutMs: number): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          const entry = drop(id);
          if (!entry) return;
          entry.reject(new SyncTimeoutError(id, timeoutMs));
          onTimeout(id);
        }, timeoutMs);
        entries.set(id, { resolve, reject, timer });
      });
    },

    resolve(id: string, value: T): boolean {
      const entry = drop(id);
      if (!entry) return false;
      entry.resolve(value);
      return true;
    },

    rejectAll(reason: Error): void {
      // Snapshot and clear BEFORE rejecting: a rejection handler may
      // synchronously enqueue a new request, and it must not find itself in
      // the batch being torn down.
      const inFlight = [...entries.values()];
      entries.clear();
      for (const entry of inFlight) {
        clearTimeout(entry.timer);
        entry.reject(reason);
      }
    },

    size(): number {
      return entries.size;
    },
  };
}
