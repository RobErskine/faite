import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { uuidv7 } from "uuidv7";
import { RATE_LIMIT, RATE_WINDOW_MS } from "@/lib/email-limits";
import { emailIngest } from "./schema";

/**
 * The secret ingest address: generating it, resolving it back to a user, and
 * the rate window that hangs off the same row (EI-186).
 *
 * The top half is pure and is what `addresses.test.ts` covers. The bottom
 * half is the D1 access, kept in the same file because every query here is a
 * single statement against one table and splitting it would buy nothing.
 *
 * **The address IS the credential.** Sender matching is not a viable second
 * factor — envelope `from` is trivially spoofed, and forwarding rewrites it
 * anyway. So the local part carries 80 bits of entropy, is revocable, and is
 * never reissued.
 */

/**
 * Crockford base32 — `i`, `l`, `o`, and `u` are absent, so the address
 * survives being read off a screen and typed into a phone's contact list
 * without the classic 1/l and 0/O transcription failures. Lowercase because
 * that is what a mail client will show and what `splitRecipient` normalizes
 * to.
 */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * 80 bits, rendered as 16 characters. Sized against the actual threat: a
 * catch-all subdomain invites sustained address probing, and anything
 * short enough to be guessable is a stranger's todo landing in your Backlog.
 */
export function newLocalPart(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/** Full address for a stored local part. */
export function ingestAddress(localPart: string, domain: string): string {
  return `${localPart}@${domain}`;
}

export interface Recipient {
  /** The lookup key — the local part with any `+tag` removed. */
  key: string;
  /** Everything after the first `+`, or null. A routing hint, not a secret. */
  tag: string | null;
}

/** Local parts we will even bother asking D1 about. Our own alphabet plus
 * `-`, which is reserved for a future human-readable prefix. */
const KEY_PATTERN = /^[0-9a-z-]{1,64}$/;

/**
 * Splits an envelope recipient into a lookup key and a `+tag`.
 *
 * The tag is stripped for lookup but **preserved and handed to the mapper**.
 * `<localpart>+family@` is a zero-infrastructure precursor to the forwarding
 * rules in the follow-up ticket: it costs nothing to carry now, and
 * discarding it would mean rewriting this seam later.
 *
 * Case is normalized. RFC 5321 permits case-sensitive local parts; no mail
 * system on earth actually implements that, our alphabet is lowercase-only,
 * and a user who types the address in title case should not get a bounce.
 */
export function splitRecipient(rcptTo: string, domain: string): Recipient | null {
  const normalized = rcptTo.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return null;
  if (normalized.slice(at + 1) !== domain.toLowerCase()) return null;

  const localPart = normalized.slice(0, at);
  const plus = localPart.indexOf("+");
  const key = plus === -1 ? localPart : localPart.slice(0, plus);
  const rawTag = plus === -1 ? "" : localPart.slice(plus + 1);

  if (!KEY_PATTERN.test(key)) return null;
  return { key, tag: rawTag.length > 0 ? rawTag : null };
}

/**
 * Re-exported so this module stays the one place the email code imports
 * address/rate concerns from, while the numbers themselves live where the
 * Settings panel can also read them. See `@/lib/email-limits`.
 */
export { RATE_LIMIT, RATE_WINDOW_MS } from "@/lib/email-limits";

export interface RateWindow {
  windowStart: number | null;
  windowCount: number;
}

/**
 * Fixed-window counter, evaluated against the row we already had to read to
 * resolve the user at all.
 *
 * A rejected message does NOT increment the count — the window is a budget of
 * accepted messages, so a flood cannot extend its own lockout past the hour
 * it started in. That matters more than it looks: every rejection is a
 * permanent bounce back to the sender, and a forwarder that collects enough of
 * them (Gmail, for one) disables the forwarding rule outright. (`docs/API.md` suggests the Durable Object for per-user
 * limits. That is right for API traffic and wrong here: the DO is addressed
 * by `idFromName(userId)`, so reaching it means a round trip we would be
 * paying before knowing whether to reject at all.)
 */
export function nextRateWindow(
  current: RateWindow,
  now: number,
): { allowed: boolean; next: RateWindow } {
  const expired = current.windowStart === null || now - current.windowStart >= RATE_WINDOW_MS;
  if (expired) return { allowed: true, next: { windowStart: now, windowCount: 1 } };
  if (current.windowCount >= RATE_LIMIT) return { allowed: false, next: current };
  return { allowed: true, next: { ...current, windowCount: current.windowCount + 1 } };
}

/** One row of `email_ingest`, as the resolver needs it. */
export interface IngestAddressRow {
  id: string;
  userId: string;
  revokedAt: Date | null;
  windowStart: number | null;
  windowCount: number;
}

export type IngestDecision =
  | { ok: true; addressId: string; userId: string; next: RateWindow }
  | { ok: false; reason: "unknown-address" | "revoked-address" | "rate-limited" };

/**
 * Pure half of the resolve step: given the row (or its absence) and the
 * clock, decide. Kept separate from the query so every branch is testable
 * without a D1 binding.
 *
 * Unknown and revoked are reported distinctly for our own logs but must
 * reject with the SAME SMTP reason at the seam — telling a prober which of
 * their guesses corresponds to a real-but-rotated address is a free oracle.
 * See `ingest.ts`.
 */
export function decideIngest(row: IngestAddressRow | null, now: number): IngestDecision {
  if (!row) return { ok: false, reason: "unknown-address" };
  if (row.revokedAt !== null) return { ok: false, reason: "revoked-address" };

  const { allowed, next } = nextRateWindow(
    { windowStart: row.windowStart, windowCount: row.windowCount },
    now,
  );
  if (!allowed) return { ok: false, reason: "rate-limited" };
  return { ok: true, addressId: row.id, userId: row.userId, next };
}

/**
 * A stable, non-reversing label for logs. The local part is the credential,
 * so it must never be logged verbatim — but "which address was this" is the
 * one thing you need when debugging a rejection, so log a short digest of it
 * instead. Truncated to 12 hex chars: enough to correlate two log lines,
 * useless for recovering the address.
 */
export async function localPartHash(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest).slice(0, 6)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- D1 -------------------------------------------------------------------

function db(binding: D1Database) {
  return drizzle(binding, { schema: { emailIngest } });
}

/** Looks up an address by its lookup key. Revoked rows are returned, not
 * filtered — `decideIngest` needs to tell "never existed" from "burned". */
export async function loadByLocalPart(
  binding: D1Database,
  key: string,
): Promise<IngestAddressRow | null> {
  const rows = await db(binding)
    .select({
      id: emailIngest.id,
      userId: emailIngest.userId,
      revokedAt: emailIngest.revokedAt,
      windowStart: emailIngest.windowStart,
      windowCount: emailIngest.windowCount,
    })
    .from(emailIngest)
    .where(eq(emailIngest.localPart, key))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    revokedAt: row.revokedAt ?? null,
    windowStart: row.windowStart ? row.windowStart.getTime() : null,
    windowCount: row.windowCount,
  };
}

/**
 * Commits the accepted message against the row: the new window and
 * `lastUsedAt`, in the one UPDATE we were already going to spend.
 */
export async function markAccepted(
  binding: D1Database,
  addressId: string,
  window: RateWindow,
  now: number,
): Promise<void> {
  await db(binding)
    .update(emailIngest)
    .set({
      lastUsedAt: new Date(now),
      windowStart: window.windowStart === null ? null : new Date(window.windowStart),
      windowCount: window.windowCount,
    })
    .where(eq(emailIngest.id, addressId));
}

export interface ActiveAddress {
  localPart: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** The user's current (non-revoked) address, or null if they have none. */
export async function activeAddressFor(
  binding: D1Database,
  userId: string,
): Promise<ActiveAddress | null> {
  const rows = await db(binding)
    .select({
      localPart: emailIngest.localPart,
      createdAt: emailIngest.createdAt,
      lastUsedAt: emailIngest.lastUsedAt,
    })
    .from(emailIngest)
    .where(and(eq(emailIngest.userId, userId), isNull(emailIngest.revokedAt)))
    .limit(1);

  const row = rows[0];
  return row ? { ...row, lastUsedAt: row.lastUsedAt ?? null } : null;
}

/**
 * Issues a new address. Retries once on the unique index — at 80 bits a
 * collision is not a real event, but a retry is two lines and the
 * alternative is a 500 nobody can reproduce.
 */
export async function createAddressFor(
  binding: D1Database,
  userId: string,
): Promise<ActiveAddress> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = {
      id: uuidv7(),
      userId,
      localPart: newLocalPart(),
      createdAt: new Date(),
      revokedAt: null,
      lastUsedAt: null,
      windowStart: null,
      windowCount: 0,
    };
    try {
      await db(binding).insert(emailIngest).values(row);
      return { localPart: row.localPart, createdAt: row.createdAt, lastUsedAt: null };
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  // Unreachable — the loop either returns or rethrows.
  throw new Error("createAddressFor: exhausted retries");
}

/** Existing address, or a freshly issued one. */
export async function ensureAddressFor(
  binding: D1Database,
  userId: string,
): Promise<ActiveAddress> {
  return (await activeAddressFor(binding, userId)) ?? (await createAddressFor(binding, userId));
}

/**
 * Revokes every live address for this user and issues a new one.
 *
 * The old rows are updated, never deleted: the unique index on `localPart`
 * is what stops a burned address from ever being reissued, and it can only
 * do that job while the row still exists.
 */
export async function rotateAddressFor(
  binding: D1Database,
  userId: string,
): Promise<ActiveAddress> {
  await db(binding)
    .update(emailIngest)
    .set({ revokedAt: new Date() })
    .where(and(eq(emailIngest.userId, userId), isNull(emailIngest.revokedAt)));
  return createAddressFor(binding, userId);
}
