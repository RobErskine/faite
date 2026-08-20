/**
 * D2a: the one-time code that rides the `faite://auth-callback` deep link.
 *
 * The system-browser login flow mints a real, long-lived API key
 * (`auth-tokens.ts`'s `apiTokenPlugin`) once the user signs in — but the
 * only channel back to the desktop app is the URL the OS hands to it, and a
 * long-lived credential sitting in a URL (browser history, OS "recent
 * items", any logging the browser or its extensions do on navigation) is
 * exactly the exposure decision #3 (bearer-in-keychain, never localStorage)
 * is trying to avoid. So the URL carries this instead: the real key,
 * AES-GCM encrypted with a subkey derived from `BETTER_AUTH_SECRET`, plus a
 * short expiry, opaque and useless without the server's secret.
 *
 * **Deliberately stateless — no D1 table, no migration.** This repo's own
 * `.ai/lessons.md` has more hard-won scars about D1 migrations than any
 * other topic; a one-time-code table for a 60-second handoff window isn't
 * worth adding one. The tradeoff, stated plainly rather than silently
 * assumed: this is TTL-bounded, not single-use-enforced — nothing stops the
 * same code being exchanged twice inside its 60s window. That's an
 * acceptable bar for a same-machine loopback handoff (an attacker would need
 * to intercept the OS's URL-open dispatch on the user's own Mac within a
 * minute of a login they just performed), not a general-purpose OAuth
 * authorization-code implementation. Revisit if this pattern is ever reused
 * for something with a larger attack surface.
 */

const HKDF_INFO = new TextEncoder().encode("faite-desktop-handoff-v1");
const CODE_TTL_MS = 60_000;

interface HandoffPayload {
  key: string;
  exp: number;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: HKDF_INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** `apiKey` is the plaintext API key returned once by `createApiKey`. */
export async function encodeHandoffCode(apiKey: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload: HandoffPayload = { key: apiKey, exp: Date.now() + CODE_TTL_MS };
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return base64UrlEncode(combined);
}

/**
 * Returns the plaintext API key, or `null` for anything that isn't a valid,
 * unexpired code — malformed base64, a truncated buffer, a failed GCM auth
 * tag (tampered or encrypted under a different secret), or an expired
 * `exp`. Deliberately one failure shape for all of these: the caller (the
 * `/api/desktop/exchange` route) only ever needs to know "usable or not".
 */
export async function decodeHandoffCode(code: string, secret: string): Promise<string | null> {
  let combined: Uint8Array;
  try {
    combined = base64UrlDecode(code);
  } catch {
    return null;
  }
  // 12-byte IV + at least the 16-byte GCM auth tag.
  if (combined.length < 28) return null;

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  let plaintext: ArrayBuffer;
  try {
    const key = await deriveKey(secret);
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch {
    return null;
  }

  let payload: HandoffPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
  if (typeof payload.key !== "string" || !payload.key || typeof payload.exp !== "number") return null;
  if (Date.now() > payload.exp) return null;

  return payload.key;
}
