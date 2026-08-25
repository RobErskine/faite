# Attachments (EI-242)

Files — images, PDF, CSV, text — attached to a todo.

This is the first blob plane in the app. Before it, `docs/EMAIL-INGEST.md`
could say "there is no blob store" as a flat fact, and `avatar-image.ts` went
to real lengths (downscale to a 64 KB WebP data URL) to avoid needing one.

## 1. The constraint that shapes everything

Faite is local-first. Every write lands in Dexie and appends a **JSON field
patch** to the outbox, which syncs field-by-field under HLC last-write-wins
(`docs/SYNC.md`).

**Bytes cannot travel that path.** So an attachment lives in two planes:

| Plane | What | Where | How it moves |
|---|---|---|---|
| Metadata | filename, MIME type, size, storage key | Dexie + the user's DO | The ordinary outbox — no new sync code |
| Bytes | the file itself | R2 (`ATTACHMENTS` binding) | `POST`/`GET /api/attachments`, never the outbox |

### The ordering invariant

**Bytes first, row second.**

`POST /api/attachments` stores the object and returns metadata. The *client*
then writes the `attachment` row through `mutate()`. So a row can never
reference an object that is not there. The reverse — an object with no row —
is possible, costs storage, and breaks nothing.

Deleting inverts it, for the same reason: **tombstone first, then delete the
bytes.** The tombstone is the half that syncs, so it must be durable first. A
failure after it leaves an orphan, not a broken reference.

Both directions are pinned by `src/lib/store/attachments.test.ts`.

## 2. Why a separate entity kind

An `attachments` JSON array field on `todoSchema` would have been far less
work, and would have ridden `/api/v1/todos` and every MCP tool for free.

It is wrong because **field-level LWW keys on the field name**. One array
field means two devices each attaching a file to the same todo resolve to one
winner — the loser's upload vanishes from the board and its R2 object is
orphaned with nothing to collect it. One row per file gives each its own
clocks, so concurrent attaches both survive.

The entity kind was added by the recipe in `docs/SCHEMA-CHANGES.md`
§"add a new entity kind" (migration 18). One note it did not cover:
`UserDurableObject.listEntities()` ended in an unconditional
`ORDER BY position`, and attachments have no `position` column. That is now an
explicit `ORDER_BY_KIND` map — **adding a kind to it means checking that kind
really has `deleted_at` and the column named.**

## 3. Limits, and the owner exception

All in `src/lib/attachment-limits.ts` — one zero-import module, read by both
the Worker (which enforces) and the sheet (which states), following
`email-limits.ts`.

| | Everyone | Owner |
|---|---|---|
| Per file | 5 MB | 25 MB |
| Per account | 1 GB | 20 GB |

**Why the owner cap is 25 MB and not "unlimited".** Two ceilings sit below any
larger number and both are real:

1. Cloudflare rejects a request body over the **account plan's** limit — 100 MB
   here — with a 413 at the edge, before the Worker runs. "No cap" would be
   "100 MB with a confusing error".
2. `handleUpload` buffers the body to sniff its magic bytes, and a Worker has
   ~128 MB of memory. Buffering near 100 MB OOMs the isolate, which surfaces
   as a dead request rather than an error.

### Raising the cap

Not a constant edit. It means switching `handleUpload` to stream into R2 and
sniff only the first chunk, plus a counting `TransformStream` to enforce the
size mid-stream and delete the partial object when it is exceeded. R2's
multipart API (`createMultipartUpload`) is the path past the request-body
limit entirely.

### Who is the owner

There is no admin or role concept in this codebase, and this feature did not
invent one. `OWNER_EMAILS` in `wrangler.jsonc` `vars` is the whole mechanism —
comma-separated, matched case-insensitively against the session's email.

**`emailVerified` is load-bearing.** Sign-up is open, so an unverified match
must not count, or anyone could register the owner's address and claim the
cap. `src/server/attachments/is-owner.test.ts` covers the refusals.

This is cheap only because uploads are cookie-session-only: `user.email` and
`user.emailVerified` are already on the session, so no D1 lookup is needed. A
bearer path wanting the raised cap would have to make `ScopeResult`
(`auth-scopes.ts`) resolve an email first.

## 3a. Preview (EI-243)

Clicking an attachment's name (or its thumbnail) opens a dialog. Four
renderers, chosen by `PREVIEW_KIND` in `attachment-limits.ts`:

| Type | Rendered by | Notes |
|---|---|---|
| PNG / JPEG / GIF / WebP | `<img>` | Already served `inline`; nothing special needed |
| PDF | `<iframe>` at `?preview=1` | The browser's own viewer — see the warning below |
| CSV | Our own table | Parsed by `src/lib/csv.ts` |
| Plain text / Markdown / JSON | `<pre>` | Source, not rendered |

**Text and CSV are fetched as text and drawn by us**, never handed to the
browser as markup. That is why Markdown previews as source: rendering it
would mean running an HTML pipeline over an untrusted file, for a nicety.
Text reads are capped at `MAX_PREVIEW_TEXT_BYTES` and CSV at
`MAX_PREVIEW_CSV_ROWS`, and the dialog says when it truncated rather than
silently showing a fraction.

Anything else has no preview and says so. An honest empty state beats a
viewer that shows a blank rectangle.

### How the PDF preview is contained (EI-244)

Attachment bytes are served from **`files.myfaite.app`**, a different origin
from the app. A previewed PDF therefore renders cross-origin, and the
same-origin policy isolates it: the app cannot read the frame's
`contentDocument`, and touching its `localStorage` throws `SecurityError`.
Both measured in a browser, not inferred.

**This is what the `sandbox` attribute could not do.** Chrome's PDF viewer
refuses to render inside a sandboxed iframe — every flag combination tried
(EI-243) produced a broken-file icon with a 200 response and no error. Going
cross-origin gives containment *and* rendering, which is the whole reason
EI-244 existed.

The iframe therefore carries **no `sandbox` attribute, deliberately**. Adding
one back would break rendering again and buy nothing the origin split does
not already provide.

### How reads are authorised

The session cookie is host-only (`Path=/; HttpOnly; SameSite=Lax`, **no
`Domain=`** — verified against a running server), so it never reaches
`files.myfaite.app`. That origin has no credential at all, which is exactly
the property that makes it safe to render someone's file there: even if a
hostile PDF ran script, there is no session for it to steal.

Reads are authorised by a **short-lived signed token** instead
(`attachments/signing.ts`). `GET /api/attachments/{id}` on the app origin
authenticates the cookie session, mints a token, and 302s. A redirect rather
than an API returning a URL because `<img src>`, `<a download>` and
`<iframe src>` are all synchronous — this way no call site had to change.

- HMAC-SHA256, keyed by HKDF from `BETTER_AUTH_SECRET` with a versioned
  `info` label. Domain separation means this key cannot forge a session and a
  session key cannot forge a URL, and there is no second secret to provision
  and forget.
- Five-minute expiry. These URLs are not shareable by design; the app mints a
  fresh one per view.
- Forged signature, edited payload, and expired token are all one `403`.
  Distinguishing them tells an attacker which half to keep working on.

### The one exception: text and CSV

`?raw=1` streams those from the **app** origin, deliberately. The isolated
origin exists to contain what the BROWSER renders; text and CSV are fetched
and escaped by us, so the browser never interprets them. Routing them
cross-origin would buy nothing and would force
`Access-Control-Allow-Credentials: true` on the user-content origin — the one
thing that origin is designed never to advertise. `?raw=1` always serves
`Content-Disposition: attachment`, whatever the type, which is what makes it
safe to leave open rather than type-gated.

### What a subdomain does not give you

`files.myfaite.app` shares a registrable domain with the app. Today that is
fine: the session cookie is host-only, so it does not travel. The residual
risk is that someone later enables `crossSubDomainCookies` or sets a
`Domain=.myfaite.app` cookie for an unrelated reason, and the isolation
quietly disappears with nothing failing.

`attachments/cookie-isolation.test.ts` is that failure. A separate registrable
domain would remove the risk outright rather than guarding it; that remains
the upgrade path, and it is now a one-line change to `ATTACHMENTS_ORIGIN`
plus DNS.

### Local development

`wrangler dev` simulates the configured routes, so **locally the request's
hostname, its `Host` header and `request.cf` all report production** — there
is no runtime signal to derive the origin from. Hence `ATTACHMENTS_ORIGIN` is
an explicit var, blanked in `.dev.vars` so bytes are served same-origin on a
laptop. That path is functional and **not isolated**, which is fine there and
never in production. See `docs/SETUP.md`.

## 4. Security

- **SVG is not allow-listed, and must stay that way.** It is an image
  everywhere else in a UI and a script host here; rendered inline from our own
  origin it is stored XSS against the board.
- Every download carries `Content-Disposition: attachment` and
  `X-Content-Type-Options: nosniff`. That is the second guard, not the only
  one — the allow-list does not depend on a header surviving a refactor.
- The declared `Content-Type` is a **claim**. It is checked against the
  allow-list *and* against the bytes (magic numbers; strict UTF-8 decoding for
  the text types). A mismatch is a rejection, never a correction.
- Filenames are display text only. They never reach an R2 key
  (`storage.ts` derives keys from ids), and are stripped of quotes, control
  characters and separators so they cannot inject into `Content-Disposition`.
- Keys are `att/{ownerId}/{id}-{nonce}`. The bucket has no public access and
  the download route checks the row's `ownerId` against the session, so the
  nonce is defence in depth against a future misconfiguration, not the
  control.
- Route errors never echo `error.message` — a parser failure can quote the
  bytes it choked on, and those are the user's file.

## 5. What v1 leaves out

- **Offline attach, and offline viewing.** Bytes live server-side only. Offline
  you can neither attach a file nor open one this device has not already
  fetched. The UI says so rather than showing a broken image. Closing this
  means blob bytes in Dexie, a second queue outside the outbox, and a
  per-attachment state machine (`pending`/`uploading`/`stored`/`failed`).
- **API and MCP writes.** `GET /api/v1/attachments` and the `list_attachments`
  MCP tool are read-only. A write there would have to carry file bytes, and
  that API is JSON. Consumers get each row's `id` and fetch
  `GET /api/attachments/{id}` themselves — deliberately not a stored URL
  column, since the generic `/api/v1` dispatch returns `schema.parse(row)`
  verbatim and a stored URL would be a second thing to keep true.
- **Preview of anything beyond images / PDF / CSV / text.** Office formats
  are zip containers with a stable magic number and would be an allow-list
  addition plus a renderer; nothing has asked for them.
- **Drag-and-drop onto a card.** Orthogonal to the board's own dnd — dnd-kit
  runs on `MouseSensor`/`TouchSensor`, not HTML5 drag events
  (`docs/DRAG-AND-DROP.md` §4.8) — so this is available work, not blocked work.

## 6. Orphaned bytes

Sync deletes are **soft** (`deletedAt`). R2 objects are not. Three ways an
object outlives its row:

1. `deleteAttachment`'s byte delete fails — logged, deliberately non-fatal.
2. A todo is deleted. **Its attachments' bytes are not swept today.** Known
   debt, called out rather than hidden.
3. An upload succeeds and the row write never happens (a crash between the
   two). **Still open** — the sweep works from rows, and this leaves no row
   to work from. Closing it needs a reconciling pass that lists
   `att/{ownerId}/` and compares against live rows, with a minimum object age
   so it cannot race an upload in flight.

`attachmentBytesTotal()` counts non-deleted rows only, so the quota
under-counts real storage by however much is orphaned. Counting tombstones
instead would be worse — a user who deleted everything could never upload
again.

**EI-245 closed causes 1 and 2. Cause 3 is still open**, and is a crash
window rather than a routine path.

### How collection works now

Two halves, and the split is the whole design:

1. **Deleting a to-do cascades a TOMBSTONE to its attachments**, and
   deliberately does not touch R2 (`deleteTodo`,
   `src/lib/store/repositories.ts`). A to-do delete is undoable — ⌘Z restores
   the rows — so deleting the bytes there would produce live rows pointing at
   nothing, the mirror image of the failure the bytes-first ordering
   prevents. `deleteTodo` returns the tombstoned ids so they join the same
   undo entry; without that, ⌘Z restored the to-do with its files silently
   detached.
2. **A Durable Object alarm collects the bytes once the tombstone is past
   undo** (`UserDurableObject.alarm()`, window in
   `src/server/attachments/sweep.ts`). A DO alarm rather than a global cron
   because this object already knows its own rows and its R2 keys are
   namespaced by owner — nothing to fan out over, no cross-account query to
   get wrong. Alarms were unused here before, so it conflicts with nothing.

`swept_at` is a **server-only column** (same footing as `version`: in
`SERVER_ONLY_FIELDS`, absent from the Zod schema, never sent to a client).
R2's delete is idempotent, so re-deleting would be harmless — but without the
mark, every tombstone the account has ever produced matches the sweep query
forever and the alarm's work grows without bound.

**The window is an undo window, not a tidiness setting.** Shortening it below
the time a person can press ⌘Z reintroduces exactly the bug the two-phase
design exists to avoid. `sweep.test.ts` asserts the refusals rather than the
collections, for that reason.

## 7. Testing it end to end

Unit and e2e cover what they can. The upload path needs a live Worker **and**
the R2 binding, which neither `next dev` nor the Playwright harness provides
(`docs/E2E.md` §9), so the round trip is a manual check:

```
npm run preview          # the Worker, with real bindings, on :8787
```

1. Sign in (the routes are session-only; signed out, every one 401s).
2. Open a todo → **Attachments** → attach a PNG. The row appears with a
   thumbnail; the card gets a paperclip badge.
3. `npx wrangler r2 object get faite-attachments <storageKey>` — the bytes are
   really there.
4. Rename a `.zip` to `.png` and attach it → 415 `content-mismatch`.
5. Attach a 6 MB file as a non-owner → 413. As the owner → accepted.
6. Remove it → the row goes, and `wrangler r2 object get` now 404s.
7. Sign in on a second device → the row syncs, and the thumbnail loads from
   R2 without the bytes ever having synced.

**Preview (EI-243), same session:**

8. Click a PNG's name → the image fills the dialog.
9. Click a PDF's name → the browser's PDF viewer renders inside the dialog,
   with page thumbnails and zoom. **If it shows a broken-file icon, check
   whether someone re-added a `sandbox` attribute to the iframe** — that is
   the known failure, and it looks like a corrupt file rather than a config
   change.

   To test the ISOLATION locally, point `ATTACHMENTS_ORIGIN` at
   `http://127.0.0.1:8789` in `.dev.vars` — a different origin from
   `localhost:8789`, so the same-origin policy applies exactly as in
   production. Then, from the console:

   ```js
   const f = document.querySelector('[data-slot="dialog-content"] iframe');
   f.contentDocument;              // expect null
   f.contentWindow.localStorage;   // expect SecurityError
   ```

   Both must fail. If either succeeds, the bytes are being served from the
   app origin and the containment is gone.
10. Click a CSV's name → a table. Test it with a file that has a comma inside
    a quoted field, a newline inside a quoted field, and a doubled quote;
    all three are what a naive split gets wrong, and all three are covered by
    `src/lib/csv.test.ts`.
