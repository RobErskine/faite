/**
 * The one-time code that rides an app's auth deep link — `faite://auth-callback`
 * for the desktop shell (D2a), `raycast://extensions/Rob/faite/...` for the
 * Raycast extension (A18, EI-298).
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
 *
 * **Still lives under `desktop/` although Raycast uses it too.** Moving it to
 * a neutral home would churn every existing import and test for no behavior
 * change; the desktop flow is simply where it was born. If a third consumer
 * appears, move it then.
 *
 * ## Domain separation (A18, EI-298)
 *
 * The HKDF `info` string is a DOMAIN SEPARATOR, and each flow gets its own.
 * Sharing one would derive the same AES key for both, which means a code
 * minted by `/api/desktop/handoff` would decrypt at `/api/raycast/exchange`
 * and vice versa — the two envelopes become interchangeable, and a grant
 * intended for one client is redeemable by the other. The flows hand out
 * different scopes (desktop gets `sync`/`places`; Raycast deliberately does
 * not), so that interchange would be a privilege escalation, not a cosmetic
 * mix-up.
 *
 * Free to prevent now; awkward once codes are in the wild.
 */

/** The desktop flow's separator. Unchanged, so every code already in flight
 * keeps decoding. */
export const DESKTOP_HANDOFF_INFO = "faite-desktop-handoff-v1";

/** The Raycast flow's separator (A18, EI-298). Must never equal the above. */
export const RAYCAST_HANDOFF_INFO = "faite-raycast-handoff-v1";

const CODE_TTL_MS = 60_000;

interface HandoffPayload {
  key: string;
  exp: number;
}

async function deriveKey(secret: string, info: string): Promise<CryptoKey> {
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
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
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

/**
 * `apiKey` is the plaintext API key returned once by `createApiKey`.
 *
 * `info` defaults to the desktop separator so every existing call site is
 * unchanged; a new flow MUST pass its own (see the file header).
 */
export async function encodeHandoffCode(
  apiKey: string,
  secret: string,
  info: string = DESKTOP_HANDOFF_INFO,
): Promise<string> {
  const key = await deriveKey(secret, info);
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
 * `exp`. Deliberately one failure shape for all of these: the caller (an
 * `/exchange` route) only ever needs to know "usable or not".
 *
 * **A code minted under a different `info` fails here**, and it fails as an
 * ordinary GCM auth-tag rejection rather than a distinguishable error — which
 * is exactly the behavior domain separation is for.
 */
export async function decodeHandoffCode(
  code: string,
  secret: string,
  info: string = DESKTOP_HANDOFF_INFO,
): Promise<string | null> {
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
    const key = await deriveKey(secret, info);
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
