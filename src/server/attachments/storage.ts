/**
 * Where an attachment's bytes live in R2, and the one function that decides.
 *
 * The key is stored on the row (`attachmentSchema.storageKey`) rather than
 * recomputed on read, so this scheme can change without stranding every
 * object written under the old one. Nothing outside this file may build a
 * key by hand — a second construction site is how the two drift.
 */

/**
 * `att/{ownerId}/{attachmentId}-{nonce}`.
 *
 * Namespaced by owner so a listing is scoped per account and a stray
 * prefix delete can never cross accounts. The nonce is defence in depth
 * only: the bucket has no public access and `GET /api/attachments/{id}`
 * checks the row's `ownerId` against the session, so guessing a key buys
 * nothing today — it buys nothing tomorrow either, if someone ever attaches
 * a public domain to this bucket by mistake.
 *
 * The uploader's filename is deliberately NOT in the key. It is display
 * text; letting it reach a key would make traversal and encoding a live
 * concern instead of a non-issue.
 */
export function storageKeyFor(ownerId: string, attachmentId: string): string {
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `att/${ownerId}/${attachmentId}-${nonce}`;
}
