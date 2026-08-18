import type { Address, Email } from "postal-mime";
import { serializeSource } from "@/lib/capture-source";
import type { CreateTodoInput } from "@/lib/service/todos";

/**
 * Pure mapping: a parsed message → the `CreateTodoInput` that `createTodo`
 * pushes (EI-186).
 *
 * Split out of `ingest.ts` for the same reason `places/validate.ts` is split
 * out of `places/routes.ts` — every interesting case here (no subject, HTML
 * with no text part, a 400 KB newsletter, a `windows-1252` charset) is a
 * pure-function test, and none of them should need a Worker, a D1 binding, or
 * a Durable Object to exercise.
 *
 * Nothing in this file touches `message.raw`, attachments, or a logger. See
 * the privacy invariants in `docs/EMAIL-INGEST.md`.
 */

/** Matches the client's own title affordance rather than a storage limit —
 * a subject longer than this is a sentence, and the body already has it. */
const MAX_TITLE_CHARS = 200;

/**
 * **The one cap that matters.** `description` crosses the sync wire on every
 * future push of this todo, to every device, forever. A forwarded newsletter
 * is routinely 200 KB of markup; without this, one subscription quietly turns
 * every subsequent sync into a large one.
 */
export const MAX_DESCRIPTION_BYTES = 16 * 1024;
const TRUNCATION_MARKER = "\n\n— truncated";

/** Bounds on what goes into the `source` blob. `serializeSource` caps the
 * whole envelope at 2 KB but only knows how to shrink `window.title` and
 * `pageTitle`, so anything unbounded has to be cut here instead. */
const MAX_SOURCE_FIELD_CHARS = 200;

/**
 * A forwarding rule. **Always `[]` in v1** — the parameter exists so the
 * follow-up ticket (match `from`/domain/subject → `listId`, `labelIds`,
 * `priority`) is an addition to this function rather than a change to its
 * signature and every call site.
 */
export interface EmailRule {
  listId?: string | null;
  labelIds?: string[];
}

export interface EmailContext {
  /** ISO instant the message was received — the capture moment. */
  receivedAt: string;
  /** Envelope sender. Used only when the parsed `From:` header has no
   * address; never trusted for authorization (it is trivially spoofed). */
  envelopeFrom: string;
  /** The `+tag` from the recipient, if any. Carried into `source` so the
   * follow-up rules ticket has it; nothing routes on it yet. */
  tag: string | null;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Truncates to at most `maxBytes` UTF-8 bytes without splitting a multi-byte
 * codepoint (or a surrogate pair) in half.
 *
 * Encode once, cut the byte array, decode back — NOT the "shrink the string
 * by one character and re-measure" loop that `capture-source.ts` uses. That
 * shape is fine against a 2 KB budget and a window title; here the input is a
 * whole email body, so a 400 KB newsletter would re-encode a six-figure
 * substring on every one of a six-figure number of iterations, inside a
 * Worker with a CPU limit.
 *
 * A cut mid-sequence decodes to a single trailing U+FFFD (the WHATWG decoder
 * emits one replacement char for a sequence truncated at end-of-input), which
 * is what gets dropped here.
 */
function truncateToBytes(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= maxBytes) return s;
  const decoded = new TextDecoder().decode(bytes.subarray(0, maxBytes));
  return decoded.endsWith("\uFFFD") ? decoded.slice(0, -1) : decoded;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Deliberately naive: strip tags, keep the words.
 *
 * Only reached when the sender provided **no** `text/plain` part at all,
 * which for a human-written forward is rare — most clients send multipart.
 * A real HTML-to-markdown converter is a dependency and a rendering opinion;
 * this is a fallback whose job is "the todo has the words in it", and
 * `MarkdownField` renders the result as prose either way.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      // Script and style CONTENT, not just their tags — otherwise the todo's
      // notes open with a stylesheet.
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    // Collapse the runs of blank lines that tag-stripping a table produces.
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The display address from a parsed `From:`, which may be a group with no
 * single address of its own. */
function addressOf(address: Address | undefined): string | null {
  if (!address) return null;
  if (address.address) return address.address;
  const first = address.group?.[0]?.address;
  return first ?? null;
}

/** Plain-text body, from whichever part the sender actually provided. */
export function bodyText(parsed: Pick<Email, "text" | "html">): string {
  const text = parsed.text?.trim();
  if (text) return text;
  return parsed.html ? htmlToText(parsed.html) : "";
}

/**
 * Subject → title, with the two fallbacks a forwarded message actually
 * needs. An empty subject is common from share sheets and "send to self"
 * flows; a todo titled with the empty string renders as an unclickable blank
 * card, so it is never an acceptable outcome.
 */
export function titleFor(subject: string | undefined, body: string): string {
  const trimmed = subject?.trim();
  if (trimmed) return trimmed.slice(0, MAX_TITLE_CHARS);

  const firstLine = body.split("\n").find((line) => line.trim().length > 0)?.trim();
  if (firstLine) return firstLine.slice(0, MAX_TITLE_CHARS);

  return "(no subject)";
}

/** Body → `description`, capped. Null rather than `""` so the field matches
 * what a manually-created todo with no notes looks like. */
export function descriptionFor(body: string): string | null {
  if (!body) return null;
  if (byteLength(body) <= MAX_DESCRIPTION_BYTES) return body;
  const budget = MAX_DESCRIPTION_BYTES - byteLength(TRUNCATION_MARKER);
  return truncateToBytes(body, budget) + TRUNCATION_MARKER;
}

/**
 * The whole mapping, as one pure function.
 *
 * `listId` is deliberately **left unset (null)**. `src/lib/board.ts:518,694`
 * resolves a todo's column as
 * `(todo.listId ? listIndex.get(todo.listId) : undefined) ?? backlog` — so a
 * null `listId` already renders in Backlog with no lookup at all. Guessing
 * `seed:list:backlog` would be strictly worse: that id does not exist until
 * the client seeds its board, and a dangling id renders in no column.
 *
 * `position` is likewise absent: `buildCreateTodoEntry`'s fallback is the
 * constant `"a0"`, so every ingested todo would collide on one sort key. The
 * caller resolves a real one from the DO — see `ingest.ts`.
 */
export function emailToTodoInput(
  parsed: Email,
  rules: EmailRule[],
  context: EmailContext,
): CreateTodoInput {
  const body = bodyText(parsed);
  const from = addressOf(parsed.from) ?? context.envelopeFrom;
  // v1 ships with no rules; the reduction is here so adding one is a change
  // to `EmailRule`, not to the shape of this function.
  const applied = rules.reduce<EmailRule>((acc, rule) => ({ ...acc, ...rule }), {});

  return {
    title: titleFor(parsed.subject, body),
    description: descriptionFor(body),
    listId: applied.listId ?? null,
    labelIds: applied.labelIds ?? [],
    source: serializeSource({
      v: 1,
      kind: "email",
      at: context.receivedAt,
      email: {
        from: from.slice(0, MAX_SOURCE_FIELD_CHARS),
        subject: parsed.subject?.trim().slice(0, MAX_SOURCE_FIELD_CHARS) || undefined,
        messageId: parsed.messageId?.slice(0, MAX_SOURCE_FIELD_CHARS),
      },
    }),
  };
}
