import { apiUrl } from "../api-origin";
import { getStoredAuthToken, isDesktopShell } from "../desktop/bridge";
import type { PullResponse, PushRequest, PushResponse } from "./wire";

/**
 * The one HTTP surface for sync — `/api/sync/*`, same origin in production
 * and `npm run preview`, cross-origin in the `next dev` + separate
 * preview-instance setup and the desktop shell (D2a) alike.
 * `credentials: "include"` covers the cookie case; the desktop shell has no
 * cookie for `tauri://localhost` (docs/DESKTOP.md §7.4/§9) and authenticates
 * with its bearer token instead — both can be present on the same request
 * with no conflict, since the server tries the cookie first and only falls
 * back to the header (`auth-tokens.ts`).
 *
 * `apiUrl()`, not a bare relative path: a bare `/api/sync/push` resolves
 * against `tauri://localhost/api/sync/push` inside the desktop shell, which
 * is wrong. Same-origin deployments (the common case) get the bare path
 * back from `apiUrl()` unchanged.
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

async function authHeaders(): Promise<HeadersInit> {
  if (!isDesktopShell()) return {};
  const token = await getStoredAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function syncFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: { ...(await authHeaders()), ...init?.headers },
  });
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
