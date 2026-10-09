import { deriveKey } from "../desktop/handoff-code";

/**
 * The user's own TypeSafe Jev API key (EI-346), encrypted at rest.
 *
 * Lives in the user's Durable Object KV storage — not in the `settings` row,
 * which syncs to every device's IndexedDB, and not in D1. The DO is the only
 * thing that ever calls Jev, so the key never has to leave it.
 *
 * AES-GCM under a subkey derived from `BETTER_AUTH_SECRET`, the same scheme as
 * `desktop/handoff-code.ts`, with its own HKDF `info` so the two envelopes can
 * never decrypt each other. Rotating `BETTER_AUTH_SECRET` makes every stored
 * key unreadable; `decryptJevKey` returns null and the user saves it again.
 */

export const JEV_KEY_INFO = "faite-jev-key-v1";

/** The DO storage key. `wipe()`'s `deleteAll()` removes it with the account. */
export const JEV_KEY_STORAGE_KEY = "jev-key";

export interface StoredJevKey {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  /** The last four characters, so Settings can show which key is saved
   * without ever handing the key itself back to a browser. */
  last4: string;
}

export async function encryptJevKey(apiKey: string, secret: string): Promise<StoredJevKey> {
  const key = await deriveKey(secret, JEV_KEY_INFO);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(apiKey),
  );
  return { iv, ciphertext: new Uint8Array(ciphertext), last4: apiKey.slice(-4) };
}

/** Null for anything that will not decrypt — a rotated secret or a damaged
 * value. The caller treats that the same as "no key saved". */
export async function decryptJevKey(stored: StoredJevKey, secret: string): Promise<string | null> {
  try {
    const key = await deriveKey(secret, JEV_KEY_INFO);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: stored.iv }, key, stored.ciphertext);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
