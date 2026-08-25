/**
 * The attachment limits, in one place because **both sides need them**: the
 * Worker enforces them (`src/server/attachments/`), and the UI has to state
 * them before someone picks a 40 MB file (`todo-sheet.tsx`).
 *
 * A separate zero-import module rather than a shared import of either side,
 * for the reason `email-limits.ts` already documents: `tsc -p
 * tsconfig.worker.json` type-checks a whole imported file under the worker's
 * DOM-less `lib`, so the server importing a client module that touches
 * `window` fails the worker typecheck. This file imports nothing and can
 * therefore be read from anywhere.
 */

/** Per-file cap for everyone but the owner. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * The owner's per-file cap (`OWNER_EMAILS`, see `is-owner.ts`).
 *
 * NOT unlimited, and not the 100 MB that first sounded right. Two ceilings
 * sit below that number and both are real:
 *
 * 1. Cloudflare rejects a request body over the ACCOUNT PLAN's limit — 100 MB
 *    on this one — with a 413 at the edge, before this Worker ever runs. So
 *    "no cap" would in practice be "100 MB with a confusing error".
 * 2. `upload()` buffers the body to sniff its magic bytes (see
 *    `validate.ts`), and a Worker has ~128 MB of memory. Buffering anywhere
 *    near 100 MB OOMs the isolate, which surfaces as a dead request rather
 *    than a clean error.
 *
 * 25 MB is 5x the standard cap, comfortably inside both ceilings, and covers
 * every real PDF/CSV/screenshot. Raising it means switching `upload()` to
 * stream into R2 and sniffing only the first chunk — a deliberate change,
 * not a constant edit. See `docs/ATTACHMENTS.md` §"Raising the cap".
 */
export const MAX_OWNER_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Total stored bytes per account, counted over non-deleted rows.
 *
 * R2 bills on stored bytes, and a soft-deleted row keeps its object until
 * something sweeps it — so without this, one runaway script is an unbounded
 * bill. Generous enough that no human hits it by hand.
 */
export const MAX_TOTAL_ATTACHMENT_BYTES = 1024 * 1024 * 1024;

/** The owner's total, same reasoning, same non-infinity. */
export const MAX_OWNER_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024 * 1024;

/**
 * What may be uploaded, by verified content type.
 *
 * **`image/svg+xml` is deliberately absent, and must stay absent.** An SVG is
 * an image everywhere else in a UI and a script host here: rendered inline
 * from our own origin, it is stored XSS against the board. `serveDownload`
 * defends this a second time with `nosniff` + `Content-Disposition:
 * attachment`, but the allow-list is the guard that does not depend on a
 * header surviving a future refactor.
 *
 * Office formats (docx/xlsx) are absent only because nothing has asked for
 * them; they are zip containers with a stable magic number and would be a
 * one-line addition here plus one in `MAGIC_NUMBERS`.
 */
export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/csv",
  "text/plain",
  "text/markdown",
  "application/json",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Types the preview dialog can render, and how.
 *
 * `"image"` and `"pdf"` are rendered by the browser from the download route;
 * `"text"` and `"csv"` are FETCHED AS TEXT and rendered by us, so nothing is
 * ever interpreted as markup. Anything absent here has no preview and falls
 * back to a download link — an honest empty state beats a broken viewer.
 */
export const PREVIEW_KIND: Record<string, "image" | "pdf" | "text" | "csv"> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/webp": "image",
  "application/pdf": "pdf",
  "text/csv": "csv",
  "text/plain": "text",
  "text/markdown": "text",
  "application/json": "text",
};

export type PreviewKind = (typeof PREVIEW_KIND)[string];

export function previewKindFor(mimeType: string): PreviewKind | null {
  return PREVIEW_KIND[mimeType] ?? null;
}

/**
 * How much of a text/CSV attachment the preview will read.
 *
 * A 25 MB CSV is a legal upload, and rendering it into the DOM would hang the
 * tab. The dialog reads this much, says so, and offers the download for the
 * rest — a truncated preview that admits it is truncated.
 */
export const MAX_PREVIEW_TEXT_BYTES = 256 * 1024;

/** Rows the CSV table shows before it stops and says how many it skipped. */
export const MAX_PREVIEW_CSV_ROWS = 200;

/** Longest filename accepted. Stored for display only, never used as a key. */
export const MAX_FILENAME_LENGTH = 200;

/** The per-file cap in the unit a person reads. */
export function maxAttachmentMb(isOwner: boolean): number {
  return (isOwner ? MAX_OWNER_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES) / (1024 * 1024);
}

/** `1.4 MB`, for the attachment row in the sheet. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
