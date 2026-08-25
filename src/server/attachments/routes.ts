import {
  MAX_ATTACHMENT_BYTES,
  MAX_OWNER_ATTACHMENT_BYTES,
  MAX_OWNER_TOTAL_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "@/lib/attachment-limits";
import { attachmentSchema } from "@/lib/schema";
import { createAuth, getSessionSafe } from "../auth";
import { corsHeaders, handleOptions } from "../cors";
import { isOwnerEmail } from "./is-owner";
import { storageKeyFor } from "./storage";
import { AttachmentRejected, validateUpload } from "./validate";

/**
 * `/api/attachments/*` — the bytes half of EI-242.
 *
 * Same seam as `/api/sync/*` and `/api/v1/*`: not a Next.js Route Handler,
 * because `output: export` forbids one that reads `Request`. See
 * `docs/ARCHITECTURE.md` §2.12.
 *
 * ## Why this is separate from sync, and not a sync kind's payload
 *
 * An outbox patch is JSON and a file is not. So the two travel apart: bytes
 * come here, metadata rides the ordinary Dexie -> outbox -> DO path. The
 * ordering between them is the invariant that makes the split safe —
 *
 * **Bytes first, row second.** `POST` stores the object and returns
 * descriptive metadata; the CLIENT then writes the `attachment` row through
 * `mutate()` like any other entity (see `createAttachment` in
 * `src/lib/store/repositories.ts`). A row therefore can never reference an
 * object that is not there. The reverse — an object with no row — is
 * possible, costs storage and nothing else, and is what
 * `docs/ATTACHMENTS.md` §"Orphaned bytes" is about.
 *
 * ## Cookie sessions only
 *
 * No bearer path, deliberately. v1 uploads come from the app UI, and a
 * cookie session is the only credential that carries `user.email` /
 * `user.emailVerified` without a second D1 read — which is exactly what the
 * owner's raised cap keys on (`is-owner.ts`). `/api/v1` and MCP expose
 * attachments read-only and do not write here.
 */

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

/** Rejection code -> HTTP status. Everything here is the caller's fault. */
const STATUS_BY_CODE: Record<string, number> = {
  "too-large": 413,
  "unsupported-type": 415,
  "content-mismatch": 415,
  empty: 400,
  "missing-filename": 400,
  "filename-too-long": 400,
  "missing-todo-id": 400,
  "missing-attachment-id": 400,
};

/**
 * RFC 6266 `Content-Disposition` with both the plain and UTF-8 forms.
 *
 * `filename*=UTF-8''…` is what a modern browser reads; the bare `filename=`
 * is the fallback. `sanitizeFilename` has already removed quotes and control
 * characters, so the plain form cannot break out of its own quoting.
 *
 * ## Why images are `inline` and everything else is `attachment`
 *
 * Found by actually looking at the sheet: **Chrome will not render an
 * `attachment`-dispositioned response in an `<img>`.** The request succeeds,
 * the bytes arrive, and `naturalWidth` stays 0 — so a blanket `attachment`
 * silently makes every thumbnail a blank box. Not a header worth "keeping for
 * safety" when it breaks the feature and buys nothing here:
 *
 * - `ALLOWED_MIME_TYPES` contains only RASTER images. `image/svg+xml` is
 *   excluded precisely because an SVG is a script host, and that exclusion is
 *   the guard that matters. PNG/JPEG/GIF/WebP cannot execute anything.
 * - `validateUpload` has already confirmed the bytes really are that format,
 *   so `inline` is not trusting the uploader's label.
 * - `X-Content-Type-Options: nosniff` still rides on every response, so the
 *   browser cannot decide the file is something more interesting.
 *
 * Everything else — PDF above all — keeps `attachment`, so it is saved rather
 * than opened inside a viewer on our own origin. The download link in the UI
 * uses the `<a download>` attribute, which works for a same-origin `inline`
 * response too, so images still save on click.
 *
 * `INLINE_SAFE_TYPES` is an explicit list rather than a `startsWith("image/")`
 * check, and that is the whole point: `image/svg+xml` starts with `image/`.
 * A prefix test would quietly begin serving a script host inline the day
 * anyone added SVG to `ALLOWED_MIME_TYPES`. Naming the four safe types makes
 * that a deliberate edit in two places instead of an accident in one.
 */
const INLINE_SAFE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Types that may render inline ONLY when the caller explicitly asks
 * (`?preview=1`), and only alongside `PREVIEW_SANDBOX` below.
 *
 * PDF is here rather than in `INLINE_SAFE_TYPES` because the two are not
 * comparable risks. A raster image is inert data. A PDF is a document format
 * with its own scripting, an embedded-file feature, and a long history of
 * viewer bugs — so it renders only where we mean it to (inside the preview
 * dialog's iframe), never as a drive-by navigation someone can be linked
 * into.
 */
const PREVIEW_INLINE_TYPES = new Set(["application/pdf"]);

/**
 * Sent with every `?preview=1` response.
 *
 * **Read the limits before trusting this.** Measured in Chrome, not assumed:
 *
 * - In a browser that renders a PDF as an ordinary DOCUMENT — Firefox, which
 *   uses pdf.js — this sandbox applies, and the file lands in a unique opaque
 *   origin with no access to `document.cookie`, `localStorage`, or the
 *   embedding page. That is real containment and worth having.
 * - **In Chrome it does NOT contain the built-in PDF viewer.** With this
 *   header set and no `sandbox` attribute on the iframe, the parent can still
 *   read the frame's `contentDocument`, its `localStorage`, and its
 *   `location`. Chrome's viewer is not on the document-sandbox path.
 *
 * Adding `sandbox` to the iframe *does* contain it in Chrome — and stops the
 * PDF rendering at all, with every flag combination tried (`""`,
 * `allow-scripts`, `allow-scripts allow-popups`). Chrome's viewer refuses any
 * sandboxed frame. So the choice was containment or a working preview, not
 * both. See `attachment-preview.tsx` for why a working preview won, and
 * `docs/ATTACHMENTS.md` §5 for the condition that should change the answer.
 *
 * `allow-scripts` is required by every renderer that is itself a scripted
 * document. `allow-same-origin` is deliberately absent and the two must never
 * both be set: script plus its own origin can reach `parent` and undo the
 * sandbox, which is the whole thing being prevented.
 */
const PREVIEW_SANDBOX = "sandbox allow-scripts";

export function contentDisposition(
  filename: string,
  mimeType: string,
  preview = false,
): string {
  const inline =
    INLINE_SAFE_TYPES.has(mimeType) || (preview && PREVIEW_INLINE_TYPES.has(mimeType));
  const disposition = inline ? "inline" : "attachment";
  return `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function handleAttachmentsRequest(
  request: Request,
  env: CloudflareEnv,
): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);

  const headers = corsHeaders(request.headers.get("Origin"));
  const url = new URL(request.url);

  // `getSessionSafe`, not `.api.getSession()` — a garbage `Authorization`
  // header makes the raw call THROW rather than return null. See its doc
  // comment in `auth.ts`.
  const session = await getSessionSafe(createAuth(env, request), request);
  if (!session) return json({ error: "unauthenticated" }, 401, headers);

  const userId = session.user.id;
  const isOwner = isOwnerEmail(session.user.email, session.user.emailVerified, env.OWNER_EMAILS);
  const stub = env.USER_DO.get(env.USER_DO.idFromName(userId));

  try {
    if (url.pathname === "/api/attachments" && request.method === "POST") {
      return await handleUpload(request, env, url, { userId, isOwner, stub, headers });
    }

    const match = /^\/api\/attachments\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (request.method === "GET") {
        // `?preview=1` is a rendering hint and nothing more — it widens which
        // types may go `inline`, and never what the caller is allowed to
        // read. Ownership is checked identically either way.
        const preview = url.searchParams.get("preview") === "1";
        return await handleDownload(env, id, { userId, stub, headers }, preview);
      }
      if (request.method === "DELETE") return await handleDelete(env, id, { userId, stub, headers });
    }

    return json({ error: "not-found" }, 404, headers);
  } catch (error) {
    if (error instanceof AttachmentRejected) {
      return json(
        { error: error.code, message: error.message },
        STATUS_BY_CODE[error.code] ?? 400,
        headers,
      );
    }
    // Never echo `error.message` — an R2 or parser failure can quote the
    // bytes it choked on, and those are the user's file. Same privacy rule
    // as `docs/EMAIL-INGEST.md`.
    console.error("[faite] attachments route failed", error);
    return json({ error: "internal-error" }, 500, headers);
  }
}

interface Ctx {
  userId: string;
  stub: DurableObjectStub<import("../user-do").UserDurableObject>;
  headers: HeadersInit;
}

/**
 * `POST /api/attachments?todoId=…&id=…`
 *
 * Raw body, `Content-Type` describing it, `X-Filename` carrying the original
 * name percent-encoded (a header cannot hold arbitrary UTF-8). Not
 * `multipart/form-data`: the raw form is simpler on both ends and avoids
 * `request.formData()`'s own buffering on top of the buffering below.
 *
 * `id` is generated by the CLIENT (`newId()`, UUIDv7 like every other
 * entity) and passed in, so the id in the R2 key is the same id the row will
 * carry. The server minting its own would work too and would then need the
 * client to adopt it — one more thing to get wrong for no gain.
 *
 * The body IS buffered, and that is the constraint pinning
 * `MAX_OWNER_ATTACHMENT_BYTES` to 25 MB: `validateUpload` sniffs magic bytes,
 * which needs the head of the file, and a Worker has ~128 MB of memory.
 */
async function handleUpload(
  request: Request,
  env: CloudflareEnv,
  url: URL,
  { userId, isOwner, stub, headers }: Ctx & { isOwner: boolean },
): Promise<Response> {
  const todoId = url.searchParams.get("todoId");
  if (!todoId) throw new AttachmentRejected("missing-todo-id", "todoId is required");
  const attachmentId = url.searchParams.get("id");
  if (!attachmentId) throw new AttachmentRejected("missing-attachment-id", "id is required");

  // Refuse an oversized upload on its DECLARED length, before the body is
  // read into memory. This is an optimisation and nothing more — a client is
  // free to lie or omit the header, which is why `validateUpload` measures
  // the real thing below and is the check that actually enforces the cap.
  const perFileCap = isOwner ? MAX_OWNER_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES;
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > perFileCap) {
    throw new AttachmentRejected(
      "too-large",
      `the file is ${declaredLength} bytes; the limit is ${perFileCap}`,
    );
  }

  const bytes = new Uint8Array(await request.arrayBuffer());

  const rawFilename = request.headers.get("X-Filename");
  const validated = validateUpload(
    bytes,
    request.headers.get("Content-Type") ?? "",
    rawFilename ? decodeURIComponent(rawFilename) : null,
    isOwner,
  );

  // Account-wide quota. Checked after per-file validation so the more
  // specific, more actionable error wins when both apply.
  const totalCap = isOwner ? MAX_OWNER_TOTAL_ATTACHMENT_BYTES : MAX_TOTAL_ATTACHMENT_BYTES;
  const used = await stub.attachmentBytesTotal();
  if (used + validated.byteSize > totalCap) {
    throw new AttachmentRejected(
      "too-large",
      `this account is using ${used} of ${totalCap} attachment bytes`,
    );
  }

  const storageKey = storageKeyFor(userId, attachmentId);
  await env.ATTACHMENTS.put(storageKey, bytes, {
    httpMetadata: {
      // Recorded on the object as well as the row so a future direct-serve
      // path (or a human with `wrangler r2 object get`) sees the same truth.
      contentType: validated.mimeType,
      contentDisposition: contentDisposition(validated.filename, validated.mimeType),
    },
    customMetadata: { ownerId: userId, todoId, attachmentId },
  });

  // The client writes the row from this. Deliberately NOT written here: a
  // server-side write would bypass the outbox and the row would not exist on
  // this device until the next pull. See the header.
  return json(
    {
      id: attachmentId,
      todoId,
      filename: validated.filename,
      mimeType: validated.mimeType,
      byteSize: validated.byteSize,
      storageKey,
    },
    201,
    headers,
  );
}

/** `GET /api/attachments/{id}` — streams the bytes back. */
async function handleDownload(
  env: CloudflareEnv,
  id: string,
  { userId, stub, headers }: Ctx,
  preview = false,
): Promise<Response> {
  const row = await stub.getAttachment(id);
  if (!row) return json({ error: "not-found" }, 404, headers);

  const parsed = attachmentSchema.safeParse(row);
  // A row that fails its own schema is a half-written or pre-validation row,
  // not something to serve bytes for on a guess.
  if (!parsed.success) return json({ error: "not-found" }, 404, headers);
  const attachment = parsed.data;

  // Belt and braces — the DO is already per-user (see `getAttachment`).
  if (attachment.ownerId !== userId) return json({ error: "not-found" }, 404, headers);

  const object = await env.ATTACHMENTS.get(attachment.storageKey);
  // A row whose object is missing: possible only if a delete half-completed.
  // 404 rather than 500 — nothing is broken that a retry would fix.
  if (!object) return json({ error: "not-found" }, 404, headers);

  return new Response(object.body, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.byteSize),
      // `attachment` for everything but verified raster images, plus PDF when
      // `?preview=1` — see `contentDisposition` for why each is where it is.
      // `nosniff` rides on every response regardless, so the browser cannot
      // second-guess the type we verified.
      "Content-Disposition": contentDisposition(attachment.filename, attachment.mimeType, preview),
      "X-Content-Type-Options": "nosniff",
      // Only on the preview path: an opaque origin for the one response that
      // renders as a document rather than as data.
      ...(preview ? { "Content-Security-Policy": PREVIEW_SANDBOX } : {}),
      // Private: this response is session-scoped, and a shared cache holding
      // it would serve one account's file to another.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

/**
 * `DELETE /api/attachments/{id}` — removes the BYTES.
 *
 * The row is tombstoned separately by the client through `mutate()`, because
 * that is what syncs. Order matters and is the client's job: tombstone
 * first, then call this. A crash between the two leaves an orphaned object
 * (storage, no correctness problem); the reverse would leave a live row
 * pointing at nothing.
 *
 * Idempotent — R2's `delete` does not care whether the key was there, and
 * neither does a user clicking twice.
 */
async function handleDelete(
  env: CloudflareEnv,
  id: string,
  { userId, stub, headers }: Ctx,
): Promise<Response> {
  const row = await stub.getAttachment(id);
  if (row) {
    const parsed = attachmentSchema.safeParse(row);
    if (parsed.success && parsed.data.ownerId === userId) {
      await env.ATTACHMENTS.delete(parsed.data.storageKey);
    }
  }
  return new Response(null, { status: 204, headers });
}
