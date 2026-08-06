import type { PullResponse, PushRequest, PushResponse } from "./wire";

/**
 * The P4 WebSocket envelope (EI-49). Shared, DOM-free contract between
 * `ws-transport.ts` (browser) and `user-do.ts`'s `webSocketMessage` (Worker).
 *
 * DOM-free by contract, same rule as `wire.ts` and `hlc-core.ts`: `tsc -p
 * tsconfig.worker.json` type-checks a whole imported file under the worker's
 * DOM-less `lib`, so ONE `localStorage`/`window`/`WebSocket` reference
 * anywhere in this module would poison every `src/server` importer. In
 * particular there is **no `WebSocket` type in this file** — the DOM's
 * `WebSocket` and `@cloudflare/workers-types`' `WebSocket` are different
 * types, and neither exists in both projects. Sockets are handled by the
 * callers; this module only ever sees strings.
 *
 * There is also **no zod here**, deliberately: zod is a server-side
 * dependency of `routes.ts`, and pulling it into a module the client sync
 * path imports would ship a schema validator to every browser for no gain.
 * Structural decoding lives here; real payload validation lives in
 * `src/server/sync/validate.ts`, which is the SAME code the HTTP route runs.
 *
 * ## Why an envelope at all
 *
 * One socket carries three different conversations: request/response for
 * push, request/response for pull, and unsolicited server-initiated
 * `changed` notifications. `id` correlates a response to its request.
 * `runSyncCycle` never issues two concurrent push/pull calls itself (see
 * `engine.ts`'s coalescing), but nothing this deep in the stack should
 * assume that invariant holds forever.
 */

// ---- close codes ------------------------------------------------------

/**
 * RFC 6455 §7.4.2 reserves 4000–4999 for private application use — no
 * collision with runtime-generated codes is possible there, unlike 1008
 * ("policy violation"), which the runtime itself may also send.
 */

/** The account behind this socket was deleted. Do not reconnect. */
export const WS_CLOSE_ACCOUNT_DELETED = 4001;

/**
 * The socket outlived `MAX_SOCKET_AGE_MS` and must re-authenticate. The
 * client SHOULD reconnect immediately — the reconnect goes back through the
 * Worker, which re-checks the session cookie. See `MAX_SOCKET_AGE_MS`.
 */
export const WS_CLOSE_REAUTH_REQUIRED = 4002;

/**
 * How long a socket may serve requests on the strength of the session that
 * was verified at upgrade time.
 *
 * The HTTP path re-authenticates on EVERY request (`routes.ts` calls
 * `getSession` before touching the DO). A WebSocket authenticates exactly
 * once, at the handshake, and would otherwise keep writing after a sign-out
 * on another device, after session expiry, or after a password reset — for
 * as long as the tab stays open. The blast radius is bounded (the DO is
 * `idFromName(userId)`-scoped, so the worst case is the same user's stale
 * credential writing to their own board, never a cross-account leak), but it
 * is a genuine regression versus the HTTP path, so it gets an explicit
 * ceiling rather than an implicit "until the tab closes".
 */
export const MAX_SOCKET_AGE_MS = 60 * 60 * 1000; // 1 hour

// ---- messages ---------------------------------------------------------

/** Browser -> Durable Object. Every client message is a request with an `id`. */
export type ClientMessage =
  | { id: string; type: "push"; payload: PushRequest }
  | { id: string; type: "pull"; payload: { cursor: number; limit: number } };

/**
 * Durable Object -> browser. Correlated responses carry the request's `id`;
 * `changed` is unsolicited and has none.
 */
export type ServerMessage =
  | { id: string; type: "push-response"; payload: PushResponse }
  | { id: string; type: "pull-response"; payload: PullResponse }
  | { id: string; type: "error"; payload: { message: string } }
  /**
   * Someone else wrote. `version` is the highest version allocated by that
   * write, so a receiver whose cursor is already >= it can no-op instead of
   * pulling. That check is what makes one-socket-per-tab affordable: sibling
   * tabs share one IndexedDB, so without it every push fans out N-1
   * redundant pulls on the same device.
   */
  | { type: "changed"; version: number };

export type ClientMessageType = ClientMessage["type"];
export type ServerMessageType = ServerMessage["type"];

const CLIENT_TYPES: ReadonlySet<string> = new Set<ClientMessageType>(["push", "pull"]);
const SERVER_TYPES: ReadonlySet<string> = new Set<ServerMessageType>([
  "push-response",
  "pull-response",
  "error",
  "changed",
]);

export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

function parse(raw: unknown): Record<string, unknown> | null {
  // Binary frames are never sent by either end. Rejecting rather than
  // decoding them keeps this function total without a TextDecoder (which
  // exists in both runtimes, but would be one more thing to be wrong about).
  if (typeof raw !== "string") return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Durable-Object side. Structural only — it establishes that there is an
 * `id`, a known `type`, and an object `payload`, and nothing more. The
 * payload's real shape is `validate.ts`'s job, shared with the HTTP route.
 *
 * **Returns `null`, never throws.** A malformed frame must not be able to
 * kill a Durable Object: an uncaught throw out of `webSocketMessage` can
 * break the stub for every socket on that object, not just the offender's.
 */
export function decodeClient(raw: unknown): ClientMessage | null {
  const value = parse(raw);
  if (!value) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (typeof value.type !== "string" || !CLIENT_TYPES.has(value.type)) return null;
  if (!isPayload(value.payload)) return null;
  return value as unknown as ClientMessage;
}

/**
 * Browser side. Same contract: total, structural, never throws. A frame that
 * doesn't decode is dropped, which for a correlated response means the
 * caller's own timeout is what eventually rejects it — see `ws-transport.ts`.
 */
export function decodeServer(raw: unknown): ServerMessage | null {
  const value = parse(raw);
  if (!value) return null;
  if (typeof value.type !== "string" || !SERVER_TYPES.has(value.type)) return null;

  if (value.type === "changed") {
    // Unsolicited: no id, but the version is load-bearing (it's what lets a
    // receiver skip a redundant pull), so a `changed` without one is not
    // usable and must not be silently treated as version 0.
    if (typeof value.version !== "number" || !Number.isFinite(value.version)) return null;
    return { type: "changed", version: value.version };
  }

  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (!isPayload(value.payload)) return null;
  return value as unknown as ServerMessage;
}
