/**
 * Who gets the raised attachment cap.
 *
 * There is no admin/role concept in this codebase, and this feature is not
 * the place to invent one — a single comma-separated env var is the whole
 * mechanism, matching `EMAIL_INGEST_DOMAIN`'s precedent in `wrangler.jsonc`.
 * It is configuration, not a secret: knowing the address grants nothing.
 *
 * **`emailVerified` is load-bearing.** Sign-up is open, so without it anyone
 * could register as the owner's address and claim the higher limit before
 * ever proving they hold it. An unverified match is treated as no match.
 *
 * This works only because uploads are browser-only (v1): a cookie session
 * carries `user.email` and `user.emailVerified` already, so no extra D1
 * lookup is needed. If a bearer/API-key path ever needs the raised cap,
 * `ScopeResult` in `auth-scopes.ts` would have to start resolving an email
 * — see `docs/ATTACHMENTS.md`.
 */
export function isOwnerEmail(
  email: string | null | undefined,
  emailVerified: boolean | null | undefined,
  ownerEmails: string | undefined,
): boolean {
  if (!email || !emailVerified || !ownerEmails) return false;
  const normalized = email.trim().toLowerCase();
  return ownerEmails
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}
