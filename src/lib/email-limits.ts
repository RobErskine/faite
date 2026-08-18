/**
 * The inbound-email limits, in one place because **both sides need them**: the
 * Worker enforces them (`src/server/email/`), and the Settings panel has to
 * state them (`components/settings/email-section.tsx`).
 *
 * A separate module rather than a shared import of either side, for the reason
 * `hlc-core.ts` already documents: `src/lib/email-ingest.ts` reaches
 * `window` through `api-origin.ts`, and `tsc -p tsconfig.worker.json` checks a
 * whole imported file under the importing project's DOM-less `lib` — so the
 * server importing the client module would fail the worker typecheck. This
 * file has no imports at all and therefore can be read from anywhere.
 *
 * Duplicating the numbers instead would be the obvious shortcut and the wrong
 * one: the UI's whole job here is to tell the user what the server will
 * actually do, so a drifted copy is worse than no copy.
 */

/** Fixed window the cap is counted over. */
export const RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Accepted messages per window.
 *
 * **Over this, mail is DESTROYED, not delayed.** `setReject()` emits a
 * permanent SMTP error — Cloudflare's `ForwardableEmailMessage` has no defer
 * API — so the sender does not retry and nothing arrives later. This is a
 * data-loss cliff, not throttling, which is why the Settings panel states it
 * outright rather than leaving it to the docs.
 *
 * Sized to sit above any plausible burst of hand-forwarded mail while still
 * bounding what a leaked address can do to somebody's board.
 */
export const RATE_LIMIT = 50;

/**
 * Rejected before `message.raw` is touched. Cloudflare accepts up to 25 MiB
 * inbound; parsing that in a Worker risks the memory and CPU limits for a
 * message that is, by definition, mostly attachments we are about to discard.
 */
export const MAX_RAW_SIZE_BYTES = 10 * 1024 * 1024;

/** The same limit in the unit a person reads. */
export const MAX_EMAIL_MB = MAX_RAW_SIZE_BYTES / (1024 * 1024);
