import { apiUrl } from "@/lib/api-origin";

/**
 * The client half of `/api/email/address` (EI-186) — reveal and rotate the
 * secret forwarding address.
 *
 * Same two conventions as `lib/places/transport.ts`, for the same reasons:
 * `credentials: "include"` because the route authenticates against Better
 * Auth's session cookie and local dev is genuinely cross-origin, and
 * `apiUrl()` rather than a bare relative path because `next dev` (:3000) runs
 * no Worker at all — a relative `/api/email/...` there hits Next's 404
 * handler, which reads as "the feature is broken" rather than "there is no
 * backend on this port".
 */

export interface IngestAddress {
  /** `<localpart>@in.myfaite.app`, or null when none has been issued yet. */
  address: string | null;
  createdAt: string | null;
  /** When mail last arrived on it. Null means the address has never been used. */
  lastUsedAt: string | null;
}

/** 404 (no Worker here, i.e. `next dev`) or 401 (signed out). Both are facts
 * about the deployment or the session, not transient failures. */
export class IngestUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestUnavailableError";
  }
}

async function request(path: string, method: "GET" | "POST"): Promise<IngestAddress> {
  const response = await fetch(apiUrl(path), { method, credentials: "include" });
  if (response.status === 401) throw new IngestUnavailableError("Sign in to use email capture.");
  if (response.status === 404) throw new IngestUnavailableError("Email capture is not available here.");
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return response.json();
}

export function fetchIngestAddress(): Promise<IngestAddress> {
  return request("/api/email/address", "GET");
}

/** Idempotent — returns the existing address rather than issuing a second. */
export function createIngestAddress(): Promise<IngestAddress> {
  return request("/api/email/address", "POST");
}

/** Burns the current address and issues a new one. The old one starts
 * bouncing immediately and can never be reissued. */
export function rotateIngestAddress(): Promise<IngestAddress> {
  return request("/api/email/address/rotate", "POST");
}
