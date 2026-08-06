import { z } from "zod";
import {
  DEFAULT_PULL_LIMIT,
  MAX_PULL_LIMIT,
  MAX_PUSH_ENTRIES,
  SYNC_KINDS,
  SYNC_PROTOCOL_VERSION,
} from "@/lib/sync/wire";
import type { PushRequest } from "@/lib/sync/wire";

/**
 * Request validation for the sync surface, shared by BOTH transports.
 *
 * This module exists because P4 adds a second way into `user-do.ts`'s
 * `push()`/`pull()`. Those are ordinary class methods — RPC is just how the
 * HTTP route additionally exposes them — so a WebSocket handler can call them
 * directly with no refactor. What it CANNOT do is inherit the guards that
 * lived inline in `routes.ts`, and those guards are not decoration:
 *
 *   - `pull(cursor, limit)` interpolates `limit` straight into `LIMIT ?`
 *     (`user-do.ts`), across six kinds, with no clamp of its own. An
 *     unvalidated `limit: 999999999` pulls the entire object into memory.
 *   - `validateEntries` (`push.ts`) validates each entry but never checks
 *     `request.protocol` and never caps `entries.length`. A single
 *     200k-entry push would run as one `transactionSync`.
 *
 * So both paths call the SAME functions here. Not "mirrored" schemas —
 * mirrored validation is exactly the drift the P3 incident review warns
 * about, and there is no test that can catch two copies diverging.
 */

const pushEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(SYNC_KINDS),
  entityId: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
  hlc: z.string().min(1),
});

export const pushRequestSchema = z.object({
  protocol: z.literal(SYNC_PROTOCOL_VERSION),
  entries: z.array(pushEntrySchema).max(MAX_PUSH_ENTRIES),
});

/**
 * `null` on anything malformed — callers map that to a 400 (HTTP) or an
 * `error` envelope (WebSocket). Never throws.
 */
export function parsePushRequest(body: unknown): PushRequest | null {
  const parsed = pushRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

export interface PullArgs {
  cursor: number;
  limit: number;
}

/**
 * Clamps pull arguments from either transport.
 *
 * The asymmetry between the two inputs is deliberate and matches the
 * pre-existing HTTP behaviour exactly, so this refactor is a no-op for the
 * route:
 *
 *   - **cursor** is REJECTED when absent or invalid (`null`). A wrong cursor
 *     is not recoverable by guessing — silently substituting 0 would replay
 *     the entire object at a client that asked for a delta, and substituting
 *     anything else would skip rows.
 *   - **limit** is DEFAULTED when absent or invalid, and capped at
 *     `MAX_PULL_LIMIT` otherwise. A limit is a hint about page size; there is
 *     a correct fallback and no data-loss risk in using it.
 *
 * Accepts `unknown` so the WebSocket path (raw JSON) and the HTTP path
 * (query strings) can share one code path. `Number(null)` is 0 and
 * `Number("")` is 0, so absent-vs-zero is disambiguated by the caller
 * passing `undefined` for absent.
 */
export function clampPullArgs(cursor: unknown, limit: unknown): PullArgs | null {
  const parsedCursor = Number(cursor ?? 0);
  if (!Number.isFinite(parsedCursor) || parsedCursor < 0) return null;

  const requested = Number(limit ?? DEFAULT_PULL_LIMIT);
  const parsedLimit =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), MAX_PULL_LIMIT)
      : DEFAULT_PULL_LIMIT;

  return { cursor: Math.floor(parsedCursor), limit: parsedLimit };
}
