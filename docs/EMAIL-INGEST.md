# Email → Backlog ingest (EI-186)

Forward an email to a private address and it becomes a to-do in Backlog: the
subject is the title, the plaintext body is the notes, and provenance is
recorded in `Todo.source`.

```
sender → Email Routing (catch-all on in.myfaite.app → this Worker)
       → worker.ts email() → size guard
       → resolve the secret local part → userId (D1 `email_ingest`)
       → rate window check (same D1 row)
       → postal-mime parse, in memory
       → pure map → CreateTodoInput
       → createTodo(ctx, input, pushTransportFor(stub, userId))
       → UserDurableObject.push() → version + field_clocks + live WS broadcast
```

## The one non-negotiable

**The write goes through `push()`.** A direct write to the Durable Object's
`todos` table skips two things `push()` does inside its transaction: allocating
a `version` from `sync_meta` (the entire changelog — a pull is
`WHERE version > cursor`) and writing a `field_clocks` row per field (what
field-level LWW compares against). Skip the first and no device ever learns the
row exists. Skip the second and the next client push wins by default and erases
it. See `docs/API.md`'s "The thing that will go wrong".

Routing through `push()` also means the P4 broadcast fires, so a forwarded
email appears on an open board **live, without a reload** — which is the
cheapest possible proof that it did not take a side channel.

## Decisions

### `in.myfaite.app`, not the apex

Email Routing is zone-level and claims the apex MX by default. The apex is
wanted for a real `rob@myfaite.app` later, and Cloudflare supports *unlocking*
the root-domain MX/SPF/DKIM to point at another provider while a configured
subdomain keeps routing here. (Email Routing can also serve `rob@myfaite.app`
itself, forwarding to Gmail, as a plain routing rule.) Limit: 30
domains/subdomains per zone.

**Receiving needs no `wrangler.jsonc` binding.** The catch-all rule that sends
`*@in.myfaite.app` to this Worker is *zone configuration* — the dashboard or
the Email Routing REST API. The only thing in `wrangler.jsonc` is the
`EMAIL_INGEST_DOMAIN` var, which tells the Worker which domain to accept.

### Trust model: the address is the credential

There is no sender check, and there should not be one: envelope `from` is
trivially spoofed, and forwarding rewrites it anyway. So the local part is
80 bits of Crockford base32 (`newLocalPart()` in `src/server/email/addresses.ts`),
unique-indexed, and **never reissued** — rotation sets `revokedAt` and keeps
the row forever, so a burned address rejects rather than coming back to life
for whoever draws it next.

Unknown and revoked addresses reject with the *same* SMTP reason. A
distinguishable bounce would tell someone probing the catch-all which of their
guesses had once been real.

`+tag` is stripped for lookup and preserved for the mapper. Nothing routes on
it yet; it is the seam the forwarding-rules follow-up plugs into.

### Rate cap: 30/hour, on the row we already read

`windowStart`/`windowCount` live on `email_ingest`. Resolving the user already
reads that row and already writes back `lastUsedAt`, so the cap costs one
extra column in an UPDATE and **zero extra round trips**. A rejected message
does not increment the count, so a flood cannot extend its own lockout.

(`docs/API.md` suggests the Durable Object for per-user limits. Right for API
traffic, wrong here — the DO is addressed by `idFromName(userId)`, so reaching
it means paying a round trip before knowing whether to reject at all.)

### Size guard: reject over 10 MiB

Cloudflare accepts 25 MiB inbound. Parsing that inside a Worker risks the
memory and CPU limits for a message that is, by definition, mostly attachments
we are about to discard. Checked against `message.rawSize` **before**
`message.raw` is touched.

### The two sharp edges

**`listId` is `null`, and nothing is looked up.** `src/lib/board.ts:518,694`
resolves a column as `(todo.listId ? listIndex.get(todo.listId) : undefined) ?? backlog`,
so a null `listId` already renders in Backlog. Guessing `seed:list:backlog`
would be worse — that id does not exist until the client seeds its board, and
a dangling id renders in no column at all.

**`position` must not use the builder's fallback.** `buildCreateTodoEntry`'s
`fallbackPosition()` is `positionAtEnd(null)`, which is the *constant* `"a0"` —
every ingested to-do would collide on one sort key. `UserDurableObject`
therefore exposes `nextTodoPosition()`, mirroring the client's own
`nextTodoPosition()` (`store/repositories.ts:137`) including its two
surprises: the max is global rather than per-list, and tombstones count.

### HLC: a narrow answer, deliberately

`docs/API.md` left "who stamps the server-side HLC" open. `serverHlcClock()`
(`src/server/service/hlc.ts`) answers it **for creates only**: a create targets
an entity with no `field_clocks` rows, so there is no LWW comparison to lose
and no durable server node id is needed. Server-originated *updates* still
need the persisted-node-id answer — the clock is per-isolate, so two isolates
can issue the same stamp within a millisecond.

## Mapping

| Field | From |
|---|---|
| `title` | subject, trimmed, capped at 200 chars → first non-blank body line → `"(no subject)"` |
| `description` | `parsed.text`, else a naive tag-strip of `parsed.html`. **Capped at 16 KB** with a `— truncated` marker |
| `source` | `{ v:1, kind:"email", at, email:{ from, subject, messageId } }` via `serializeSource` |
| `listId` | always `null` (→ Backlog) |
| `position` | `UserDurableObject.nextTodoPosition()` |
| attachments | **dropped** — there is no blob store |

The 16 KB cap is the one that would have bitten silently: `description` crosses
the sync wire on **every future push of that to-do, to every device, forever**,
and a forwarded newsletter is routinely 200 KB of markup.

`serializeSource` caps the whole blob at 2 KB, but its truncation ladder only
knows how to shrink `window.title` and `pageTitle` — so `subject`, `from`, and
`messageId` are bounded at the call site instead.

## Privacy

These are invariants, and most of them are tested rather than aspirational.

1. **Raw MIME is never persisted.** `message.raw` is read exactly once, in
   `handleEmail`, streamed straight into `PostalMime.parse`, and discarded when
   the handler returns. Nothing writes it anywhere.
2. **Attachments are discarded.** `parsed.attachments` is never read.
3. **No email content in logs.** `observability.enabled` is on, so Workers Logs
   captures console output *and uncaught exception messages*. `handleEmail`
   logs only `{ decision, addressHash, userId, rawSize }` — `addressHash` is a
   truncated SHA-256 of the local part, not the local part. The handler catches
   everything itself and logs `error.name` only, because a MIME parser's
   `error.message` quotes the bytes it choked on.
4. **D1 holds no content.** `email_ingest` is local part, owner, timestamps,
   counters.
5. **The body lives in `Todo.description`** — the user's Durable Object and
   every device's IndexedDB — because that *is* the to-do. It cannot be
   auto-deleted without deleting the feature.

Two findings from the audit that made this ticket:

- **The event journal does not leak it.** `lib/store/todo-events.ts`'s
  `buildEditedPayload` records *which* fields changed but captures values only
  for `priority` and `deadline` — never `title`/`description`. Editing an email
  to-do does not copy the body into a second place.
- **There is no hard delete anywhere.** Faite is tombstone-only: deleting a
  to-do sets `deletedAt`, and the row — body included — stays in the DO's
  SQLite and every device's IndexedDB indefinitely. Pre-existing, but email
  content raises the stakes. A purge job is a follow-up ticket.

Not asserted: **Cloudflare's own retention.** Their docs describe Email Routing
as store-and-forward with no mailbox, and publish no message-content retention
policy. The message transits their infrastructure in plaintext.

Note also that under `wrangler dev` the local mail simulator prints `RCPT TO:`
and the `To:` header itself. That is miniflare's output, not ours, and not
production Workers Logs — but it does mean a local dev log contains the secret
address.

## Operating it

**Deploy with `npm run deploy:with-migrations`, not `npm run deploy`.**
Cloudflare Workers Builds does not run D1 migrations, and `email_ingest` is a
new table.

Zone setup, once:

1. Enable Email Routing on `in.myfaite.app` (dashboard → Email → Email
   Routing → subdomains).
2. Add a **catch-all** rule for that subdomain with the action *Send to a
   Worker* → `faite`.

Testing without any of that: `scripts/email-smoke/README.md`.

## Follow-ups

- **Forwarding rules** — a new synced entity kind (`emailRule`) in the DO so
  rules sync and the settings panel stays local-first; match `from`/domain/
  subject → `listId`, `labelIds`, `priority`. Full `docs/SCHEMA-CHANGES.md`
  8-file change. `emailToTodoInput(parsed, rules, context)` and the preserved
  `+tag` are the seams it plugs into.
- **Hard-delete / purge job** — nothing in this codebase ever hard-deletes, so
  email bodies survive to-do deletion indefinitely.
