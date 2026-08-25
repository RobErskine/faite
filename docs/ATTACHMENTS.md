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
- **CSV and PDF preview.** Images get a thumbnail; everything else is an icon,
  a name and a download.
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
   two).

`attachmentBytesTotal()` counts non-deleted rows only, so the quota
under-counts real storage by however much is orphaned. Counting tombstones
instead would be worse — a user who deleted everything could never upload
again. Closing this properly means a sweep (an R2 lifecycle rule, or a
scheduled pass reconciling `att/{ownerId}/` against live rows).

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
