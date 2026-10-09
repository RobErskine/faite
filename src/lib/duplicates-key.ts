import { apiUrl } from "@/lib/api-origin";

/**
 * The client half of `/api/duplicates/key` (EI-346) — the user's own
 * TypeSafe Jev key for duplicate detection. Same conventions as
 * `lib/email-ingest.ts`: `credentials: "include"` for the session cookie, and
 * `apiUrl()` because `next dev` runs no Worker.
 *
 * The key goes up once and never comes back; the server only reports whether
 * one is saved and its last four characters.
 */

export interface JevKeyStatus {
  connected: boolean;
  last4: string | null;
  /** Only on a save. `unverified` means Jev could not be reached to check
   * the key — it was saved anyway. */
  check?: "valid" | "unverified";
}

/** 404 (no Worker here) or 401 (signed out) — facts about the deployment or
 * the session, not transient failures. */
export class DuplicatesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicatesUnavailableError";
  }
}

/** Jev answered 401/403, or the field was empty. Nothing was saved. */
export class JevKeyRejectedError extends Error {
  constructor() {
    super("TypeSafe did not accept that key.");
    this.name = "JevKeyRejectedError";
  }
}

async function request(method: "GET" | "POST" | "DELETE", body?: unknown): Promise<JevKeyStatus> {
  const response = await fetch(apiUrl("/api/duplicates/key"), {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) throw new DuplicatesUnavailableError("Sign in to use duplicate detection.");
  if (response.status === 404) throw new DuplicatesUnavailableError("Duplicate detection is not available here.");
  if (response.status === 422) throw new JevKeyRejectedError();
  if (!response.ok) throw new Error(`/api/duplicates/key responded ${response.status}`);
  return response.json();
}

export const fetchJevKeyStatus = () => request("GET");
export const saveJevKey = (apiKey: string) => request("POST", { apiKey });
export const removeJevKey = () => request("DELETE");
