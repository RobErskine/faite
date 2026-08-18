import { z } from "zod";

/**
 * Capture context: where a todo came FROM — a browser tab, a native app, a
 * manual entry — as a versioned JSON blob stored verbatim in `Todo.source`.
 *
 * Same convention as `recurrenceRule` (`lib/recurrence.ts`), and for the same
 * reason: one field, not discrete `sourceUrl`/`sourceApp`/`sourceTitle`
 * columns. Under field-level LWW, splitting it would let device A's URL edit
 * merge with device B's app-name edit into a context describing no real
 * moment — the whole capture has to move as a single unit.
 *
 * Groundwork for D5 (context capture, desktop). Nothing writes or reads this
 * yet — see `docs/DESKTOP.md`.
 */

/** Hard cap on the serialized blob. It's a `text` column that crosses the
 * sync wire on every push of the todo it's attached to, so an unbounded
 * window title or page title must not blow up the row. */
export const CAPTURE_SOURCE_MAX_BYTES = 2048;

export const captureSourceSchema = z.object({
  /** Schema version. Bump and branch in `parseSource` before changing shape. */
  v: z.literal(1),
  /**
   * NOT a `z.enum` — "browser" | "app" | "manual" are today's capture
   * surfaces, but a future one (a mobile share sheet, a CLI) must be able to
   * introduce a new kind without every already-shipped client's
   * `parseSource` rejecting rows it can't render. Render code should treat
   * an unrecognized kind as "generic capture", not throw.
   */
  kind: z.string().min(1),
  /** ISO instant — the moment of CAPTURE, not the todo's `createdAt`. */
  at: z.string(),
  app: z
    .object({
      name: z.string(),
      bundleId: z.string().optional(),
    })
    .optional(),
  window: z
    .object({
      title: z.string().optional(),
    })
    .optional(),
  url: z.string().optional(),
  pageTitle: z.string().optional(),
  document: z
    .object({
      path: z.string().optional(),
    })
    .optional(),
  grants: z
    .object({
      accessibility: z.boolean().optional(),
      automation: z.boolean().optional(),
    })
    .optional(),
  /**
   * `kind: "email"` — the forward that produced this todo (EI-186).
   *
   * No DB migration: `Todo.source` is an opaque `text` column, and Zod's
   * `z.object` strips unknown keys, so a client shipped before this field
   * existed parses the new blob into a `CapturedSource` without it rather
   * than rejecting the row.
   *
   * `serializeSource`'s truncation ladder does NOT know about these fields
   * (it only shrinks `window.title`/`pageTitle`), so the caller is
   * responsible for bounding `subject` before it gets here — see
   * `src/server/email/parse.ts`.
   */
  email: z
    .object({
      /** The parsed `From:` address, or the envelope sender as a fallback. */
      from: z.string().optional(),
      subject: z.string().optional(),
      messageId: z.string().optional(),
    })
    .optional(),
});
export type CapturedSource = z.infer<typeof captureSourceSchema>;

/**
 * Null on anything malformed, truncated, or from a version/shape this build
 * doesn't understand — a bad or future blob must never crash a render. This
 * is the whole reason the blob is versioned: an older client parsing a
 * newer `v` (or an unrecognized shape) degrades to "no captured context"
 * rather than throwing.
 */
export function parseSource(raw: string | null): CapturedSource | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = captureSourceSchema.safeParse(json);
  return result.success ? result.data : null;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Truncates to at most `maxBytes` UTF-8 bytes without splitting a
 * multi-byte codepoint (surrogate pairs included) in half. */
function truncateToBytes(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (byteLength(s) <= maxBytes) return s;
  let end = s.length;
  while (end > 0 && byteLength(s.slice(0, end)) > maxBytes) {
    end--;
  }
  return s.slice(0, end);
}

/**
 * Serializes and caps the output at `CAPTURE_SOURCE_MAX_BYTES`.
 *
 * `window.title` and `pageTitle` are the only fields with realistically
 * unbounded length (a page title, a window title) — every other field is an
 * id, a flag, or an ISO instant, none of which can plausibly blow the
 * budget alone. So those two are truncated first, splitting whatever budget
 * remains between them; if the envelope is still over budget even with both
 * emptied (a pathological `url`, say), they're dropped entirely rather than
 * exceeding the cap.
 */
export function serializeSource(source: CapturedSource): string {
  const full = JSON.stringify(source);
  if (byteLength(full) <= CAPTURE_SOURCE_MAX_BYTES) return full;

  const stripped: CapturedSource = {
    ...source,
    window: source.window ? { ...source.window, title: undefined } : source.window,
    pageTitle: undefined,
  };
  const strippedJson = JSON.stringify(stripped);
  const budget = Math.max(0, CAPTURE_SOURCE_MAX_BYTES - byteLength(strippedJson));

  const hasTitle = source.window?.title !== undefined;
  const hasPageTitle = source.pageTitle !== undefined;
  const titleBudget = hasTitle && hasPageTitle ? Math.floor(budget / 2) : budget;
  const pageTitleBudget = hasTitle && hasPageTitle ? budget - titleBudget : budget;

  const truncatedTitle = hasTitle ? truncateToBytes(source.window!.title!, titleBudget) : undefined;
  const truncatedPageTitle = hasPageTitle ? truncateToBytes(source.pageTitle!, pageTitleBudget) : undefined;

  const result: CapturedSource = {
    ...source,
    window:
      source.window && truncatedTitle
        ? { ...source.window, title: truncatedTitle }
        : source.window
          ? { ...source.window, title: undefined }
          : source.window,
    pageTitle: truncatedPageTitle || undefined,
  };

  const json = JSON.stringify(result);
  // Final safety net: if even the stripped envelope alone exceeds budget,
  // there is nothing left to shrink — return it rather than loop chasing an
  // unreachable target.
  return byteLength(json) <= CAPTURE_SOURCE_MAX_BYTES ? json : strippedJson;
}
