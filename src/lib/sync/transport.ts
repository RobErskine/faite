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

/**
 * The second half of EI-147's build check, and the half that only matters
 * years from now.
 *
 * `426 Upgrade Required` from `/api/sync/*` means "this client is too old to
 * talk to me at all". **No server code sends it today**, and that is fine —
 * the point is the reverse dependency. A desktop bundle is frozen static
 * files (docs/DESKTOP.md §2 decision #2), so the server can add the 426 to a
 * future deploy whenever it needs to, but ONLY clients that already know how
 * to read it will do anything sensible when it arrives. Teaching that now
 * costs a branch; retrofitting it later is impossible for every copy already
 * installed.
 *
 * The event, rather than a new `SyncOutcome` status threaded through the
 * engine: nothing consumes a `SyncOutcome` for display today, and a status
 * only the banner reads would mean widening `runSyncCycle`, `runOnce`,
 * `createSyncRunner` and `SyncProvider` for one string. `useDesktopUpdate`
 * listens for this and re-checks `/api/desktop/version` immediately, so a
 * blocked client shows its bar within a sync cycle instead of waiting out
 * the poll interval.
 */
export const CLIENT_OUTDATED_EVENT = "faite:client-outdated";

export class SyncOutdatedError extends SyncHttpError {
  constructor(path: string) {
    super(426, `${path} refused this client version`);
    this.name = "SyncOutdatedError";
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
  if (response.status === 426) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(CLIENT_OUTDATED_EVENT));
    }
    throw new SyncOutdatedError(path);
  }
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
