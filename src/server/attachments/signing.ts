/**
 * Short-lived signed URLs for the user-content origin (EI-244).
 *
 * ## Why this exists
 *
 * Attachment bytes moved off `myfaite.app` onto `files.myfaite.app` so a
 * previewed PDF renders in a DIFFERENT ORIGIN from the app. That is what
 * finally contains it: a cross-origin iframe is isolated by the same-origin
 * policy, with no `sandbox` attribute — which matters because Chrome's PDF
 * viewer refuses to render in a sandboxed frame at all (EI-243, measured).
 *
 * The cost of moving origins is that the session cookie does not come with
 * it. It is host-only (`Path=/; HttpOnly; SameSite=Lax`, no `Domain=` —
 * verified, not assumed), so `files.myfaite.app` receives no credential and
 * cannot authenticate anyone. A signed, expiring token is what replaces it.
 *
 * **The file origin never needs a cookie, and must never be given one.** That
 * is the property that makes the split worth anything: even if a hostile file
 * runs script there, there is no session for it to steal.
 *
 * ## The key
 *
 * Derived from `BETTER_AUTH_SECRET` via HKDF with a fixed, versioned `info`
 * string, rather than provisioned as a second secret. Domain separation means
 * this key cannot be used to forge a session and vice versa, and it removes
 * an ops step that would otherwise be a silent misconfiguration waiting to
 * happen — a missing secret would only surface the first time somebody opened
 * an attachment.
 *
 * Rotating `BETTER_AUTH_SECRET` invalidates outstanding URLs. They live for
 * minutes, so that is a non-event.
 */

/** Fixed, versioned domain-separation label. Changing it rotates every URL. */
const HKDF_INFO = "faite:attachment-url:v1";

/**
 * How long a minted URL is valid.
 *
 * Long enough for a browser to follow a redirect and load a large PDF over a
 * slow connection; short enough that a URL copied out of devtools and pasted
 * somewhere is useless by the time anyone reads it. These URLs are not
 * bookmarkable by design — the app re-mints one per view.
 */
export const URL_TTL_MS = 5 * 60 * 1000;

export interface TokenPayload {
  /** Whose Durable Object holds the row. */
  userId: string;
  attachmentId: string;
  /** Epoch ms. */
  expiresAt: number;
  /** Whether the file origin may serve this `inline` (PDF preview). */
  preview: boolean;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function signingKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      // No salt: the input is already a high-entropy secret, and a random
      // salt would have to be stored and shipped with every token for no
      // gain. The `info` label is what provides domain separation.
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    material,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** `<base64url(payload)>.<base64url(hmac)>` — one opaque path segment. */
export async function mintToken(payload: TokenPayload, secret: string): Promise<string> {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await signingKey(secret);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(mac))}`;
}

export type VerifyFailure = "malformed" | "bad-signature" | "expired";

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: VerifyFailure };

/**
 * Verifies a token and returns its payload.
 *
 * `crypto.subtle.verify` rather than comparing strings: a hand-rolled `===`
 * on the MAC leaks timing. And the signature is checked BEFORE the expiry,
 * so an attacker cannot learn anything from the difference between "expired"
 * and "forged" — both are refusals, and only one of them is reachable
 * without the key.
 */
export async function verifyToken(token: string, secret: string, nowMs: number): Promise<VerifyResult> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };

  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(mac);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const key = await signingKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(body),
  );
  if (!valid) return { ok: false, reason: "bad-signature" };

  let payload: TokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
  } catch {
    // Unreachable with a valid signature unless we ourselves minted garbage,
    // but a parse that throws inside a route is a 500 rather than a 403.
    return { ok: false, reason: "malformed" };
  }

  if (
    typeof payload?.userId !== "string" ||
    typeof payload?.attachmentId !== "string" ||
    typeof payload?.expiresAt !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (payload.expiresAt <= nowMs) return { ok: false, reason: "expired" };

  return { ok: true, payload: { ...payload, preview: payload.preview === true } };
}
