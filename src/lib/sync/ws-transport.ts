import { nextAttempt, nextDelay, shouldPause } from "./backoff";
import { createPendingRequests, SyncSocketClosedError } from "./pending-requests";
import type { SyncTransport } from "./transport";
import type { PullResponse, PushRequest, PushResponse } from "./wire";
import type { ClientMessage, ServerMessage } from "./ws-protocol";
import {
  decodeServer,
  encode,
  WS_CLOSE_ACCOUNT_DELETED,
  WS_CLOSE_REAUTH_REQUIRED,
} from "./ws-protocol";

/**
 * The WebSocket half of P4's transport swap (EI-49).
 *
 * Implements the same two-method `SyncTransport` the HTTP path does, plus a
 * connection lifecycle the engine never sees. `createFallbackTransport` is
 * what decides between the two; this module only has to be honest about
 * whether it is usable right now (`isReady()`).
 *
 * ## Things that are deliberate here
 *
 * **Cookies ride the handshake, and there is no way to ask for that.** The
 * `WebSocket` constructor has no `credentials` option the way `fetch` does —
 * the browser applies its ordinary SameSite rules to the handshake. That is
 * fine same-origin (production, `wrangler dev`, `npm run preview`) and is
 * why the URL here is built from `location` rather than configured. Under
 * `next dev` the handshake simply fails, exactly as `/api/sync/*` already
 * 404s there, and under `capacitor://localhost` at P7 the cookie will not be
 * sent cross-site. In every one of those cases the fallback transport keeps
 * polling and nothing breaks — which is why give-up has to be QUIET.
 *
 * **A timeout closes the socket rather than just failing the call.** See
 * `pending-requests.ts`.
 *
 * **Nothing touches `window` at module scope.** `output: export` prerenders
 * these modules in Node at build time (ARCHITECTURE §6), so every DOM
 * reference has to sit inside a function that only runs in a browser.
 */

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
/**
 * How long to wait before re-checking `isActive()` when it is false. Not a
 * failure, so it must NOT advance the backoff ladder — a user sitting on the
 * "switch accounts?" dialog for a minute would otherwise exhaust the retry
 * budget and be stuck on polling afterwards.
 */
const INACTIVE_RECHECK_MS = 2_000;

export interface SyncConnection extends SyncTransport {
  start(): void;
  stop(): void;
  /** True only when a socket is open and usable right now. */
  isReady(): boolean;
}

export interface WsConnectionOptions {
  /**
   * `getBoundOwnerId() === session.user.id` — the SAME gate the engine uses,
   * not "has a session". A socket must not connect before local data has
   * been adopted into the signed-in account, for the same reason polling
   * must not run: during `SessionProvider`'s "switch accounts?" window the
   * session is already the new user while the board is still the old one.
   */
  isActive(): boolean;
  /** Someone else wrote; `version` is the highest version that write allocated. */
  onRemoteChange(version: number): void;
  /** Fires on every successful connect, including reconnects. */
  onOpen?(): void;
  path?: string;
  requestTimeoutMs?: number;
}

function socketUrl(path: string): string {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss:" : "ws:"}//${host}${path}`;
}

export function createWsConnection(options: WsConnectionOptions): SyncConnection {
  const path = options.path ?? "/api/sync/ws";
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  let socket: WebSocket | null = null;
  let started = false;
  /** Set when the server says the account is gone. Never reconnect after this. */
  let abandoned = false;
  let attempt = 0;
  let openedAt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const pending = createPendingRequests<ServerMessage>(() => {
    // A timed-out request means the socket is lying about being open. Tear
    // it down so `isReady()` goes false and the fallback takes over
    // immediately, instead of every later call paying the timeout too.
    console.warn("[faite] sync socket timed out; closing and falling back to polling");
    teardown(new SyncSocketClosedError("request timed out"));
    scheduleReconnect();
  });

  function clearReconnect(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function teardown(reason: Error): void {
    const dying = socket;
    socket = null;
    if (dying) {
      dying.onopen = null;
      dying.onmessage = null;
      dying.onclose = null;
      dying.onerror = null;
      try {
        dying.close();
      } catch {
        // Already closing. Nothing to do.
      }
    }
    pending.rejectAll(reason);
  }

  function scheduleReconnect(immediate = false): void {
    if (!started || abandoned) return;
    clearReconnect();
    if (shouldPause(attempt)) {
      // Not "never again" — `online` and `visibilitychange` re-arm this.
      // A closed lid or a `wrangler deploy` (which disconnects every socket
      // on every Durable Object) burns the whole ladder in seconds against a
      // network that isn't there; staying on polling for the rest of the day
      // because of that would be absurd.
      console.warn("[faite] sync socket paused after repeated failures; polling until conditions change");
      return;
    }
    const delay = immediate ? 0 : nextDelay(attempt);
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect(): void {
    clearReconnect();
    if (!started || abandoned || socket) return;
    if (typeof window === "undefined" || typeof WebSocket === "undefined") return;
    // Don't burn the retry budget while hidden: a background tab has nothing
    // to show, and a socket it holds only widens the window in which a
    // handshake-time session outlives a sign-out elsewhere.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      reconnectTimer = setTimeout(connect, INACTIVE_RECHECK_MS);
      return;
    }
    if (!options.isActive()) {
      reconnectTimer = setTimeout(connect, INACTIVE_RECHECK_MS);
      return;
    }

    let next: WebSocket;
    try {
      next = new WebSocket(socketUrl(path));
    } catch {
      attempt = nextAttempt(attempt, 0);
      scheduleReconnect();
      return;
    }
    socket = next;

    next.onopen = () => {
      openedAt = Date.now();
      // Every connect, not just the first. A reconnect means we were
      // unreachable for a while, and any `changed` broadcast during that gap
      // went to a socket that no longer existed — deploys alone guarantee
      // this happens. The persisted cursor is the backfill MECHANISM; this
      // is the missing TRIGGER.
      options.onOpen?.();
    };

    next.onmessage = (event: MessageEvent) => {
      const message = decodeServer(event.data);
      if (!message) return;
      if (message.type === "changed") {
        options.onRemoteChange(message.version);
        return;
      }
      // Unknown id: a late reply to something already timed out. Dropping is
      // correct — see `pending-requests.ts`.
      pending.resolve(message.id, message);
    };

    next.onerror = () => {
      // `onclose` always follows, and carries the code. Let it do the work.
    };

    next.onclose = (event: CloseEvent) => {
      if (socket !== next) return; // already torn down by us
      const openMs = openedAt === 0 ? 0 : Date.now() - openedAt;
      socket = null;
      pending.rejectAll(new SyncSocketClosedError(`socket closed (${event.code})`));

      if (event.code === WS_CLOSE_ACCOUNT_DELETED) {
        // The DO wiped itself out from under us. Reconnecting would just
        // re-provision storage for an account that no longer exists.
        abandoned = true;
        console.warn("[faite] sync socket closed: account deleted");
        return;
      }
      if (event.code === WS_CLOSE_REAUTH_REQUIRED) {
        // Expected and routine — the socket hit its age ceiling. Reconnect
        // straight away; the handshake re-checks the session cookie.
        attempt = 0;
        scheduleReconnect(true);
        return;
      }
      attempt = nextAttempt(attempt, openMs);
      scheduleReconnect();
    };
  }

  function wake(): void {
    if (!started || abandoned || socket) return;
    // A real signal that conditions changed, unlike a timer. Forgive the
    // ladder and try again now.
    attempt = 0;
    scheduleReconnect(true);
  }

  function request<T>(message: ClientMessage, expected: "push-response" | "pull-response"): Promise<T> {
    const live = socket;
    if (!live || live.readyState !== WebSocket.OPEN) {
      return Promise.reject(new SyncSocketClosedError("socket not open"));
    }
    // Send BEFORE registering, so a send that throws (the socket closed
    // between the readyState check and here) doesn't leave an orphaned entry
    // to time out later. There is no race: a `message` event cannot fire
    // until this function yields.
    try {
      live.send(encode(message));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new SyncSocketClosedError("send failed"));
    }
    return pending.register(message.id, timeoutMs).then((response) => {
      // Unreachable — `changed` carries no id, so it is never correlated —
      // but narrowing it away here is what lets `payload` typecheck below,
      // and an explicit throw beats a cast.
      if (response.type === "changed") {
        throw new Error("sync server correlated a broadcast to a request");
      }
      if (response.type === "error") {
        throw new Error(`sync server rejected ${message.type}: ${response.payload.message}`);
      }
      if (response.type !== expected) {
        throw new Error(`sync server replied ${response.type}, expected ${expected}`);
      }
      return response.payload as T;
    });
  }

  return {
    start(): void {
      if (started || typeof window === "undefined") return;
      started = true;
      window.addEventListener("online", wake);
      document.addEventListener("visibilitychange", wake);
      connect();
    },

    stop(): void {
      if (!started) return;
      started = false;
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      clearReconnect();
      teardown(new SyncSocketClosedError("connection stopped"));
    },

    isReady(): boolean {
      return socket !== null && socket.readyState === WebSocket.OPEN;
    },

    push(payload: PushRequest): Promise<PushResponse> {
      return request<PushResponse>({ id: crypto.randomUUID(), type: "push", payload }, "push-response");
    },

    pull(cursor: number, limit: number): Promise<PullResponse> {
      return request<PullResponse>(
        { id: crypto.randomUUID(), type: "pull", payload: { cursor, limit } },
        "pull-response",
      );
    },
  };
}
