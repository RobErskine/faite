import type { PullResponse, PushRequest, PushResponse } from "./wire";

/**
 * The one HTTP surface for sync — `/api/sync/*`, same origin in production
 * and `npm run preview`, cross-origin only in the `next dev` + separate
 * preview-instance setup and eventually Capacitor (see `auth-client.ts`'s
 * precedent). `credentials: "include"` is required either way: Better
 * Auth's session cookie is what `/api/sync/*` authenticates against.
 */

export class SyncAuthError extends Error {
  constructor() {
    super("unauthenticated");
    this.name = "SyncAuthError";
  }
}

export class SyncHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SyncHttpError";
  }
}

async function syncFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, { ...init, credentials: "include" });
  if (response.status === 401) throw new SyncAuthError();
  if (!response.ok) throw new SyncHttpError(response.status, `${path} responded ${response.status}`);
  return response;
}

export interface SyncTransport {
  push(request: PushRequest): Promise<PushResponse>;
  pull(cursor: number, limit: number): Promise<PullResponse>;
}

/**
 * Wipes the signed-in user's server-side board. Deliberately NOT part of
 * `SyncTransport`: that interface is the push/pull pair the socket and HTTP
 * paths both implement, and a reset must never ride a socket — it is a rare,
 * destructive, one-shot operation whose response nobody correlates.
 *
 * **Not a public API.** `resetAccountData()` (`src/lib/store/reset.ts`) is the
 * only supported caller, because this half alone leaves every device's pull
 * cursor stranded above the server's freshly-reset `next_version` — sync then
 * dies silently, everywhere, with no error to notice. See `docs/SCHEMA-OPS.md`.
 */
export async function resetRemoteBoard(): Promise<void> {
  await syncFetch("/api/sync/reset", { method: "POST" });
}

export const httpTransport: SyncTransport = {
  async push(request: PushRequest): Promise<PushResponse> {
    const response = await syncFetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    return response.json();
  },

  async pull(cursor: number, limit: number): Promise<PullResponse> {
    const response = await syncFetch(`/api/sync/pull?since=${cursor}&limit=${limit}`);
    return response.json();
  },
};
