# Sync — P3/P4 handoff

State of the sync work, what is settled, and what the next agent should and
should not do.

## Read first, in this order

1. **`docs/ARCHITECTURE.md`** — §2.4–§2.7 (local-first store, `mutate()`,
   field-level LWW, fractional ordering) and §2.12–§2.13 (auth, routing).
   This doc assumes all of them.
2. **`.ai/lessons.md`** — not optional. Several entries were paid for during
   exactly this work and will cost you an hour each if rediscovered: the
   `hlc-core.ts` / `hlc.ts` split and *why* a shared module cannot contain a
   single DOM-only reference; `wrangler deploy --dry-run` being the only check
   that bundles `src/server`; reading deploy warnings *below* the success
   lines; and retrying a just-provisioned Cloudflare resource before
   diagnosing it.
3. **`docs/SETUP.md`** → "Local development" — local D1 is a **separate
   database** from production, `npm run preview` does **not** hot-reload, and
   emails log to the terminal rather than sending. All three have already
   caused false bug hunts.
4. **`docs/AUTH.md`** — only if you are touching the auth seam. Sync routes
   sit next to it in `worker.ts` and reuse `createAuth(env, request)` for the
   session, so its "what a request actually does" section is the closest
   working example of the pattern you are about to copy.
5. `AGENTS.md` loads automatically via `CLAUDE.md`. Heed it: this is Next.js
   16 with real breaking changes, and `node_modules/next/dist/docs/` is the
   source of truth over anything remembered.
6. **If you're picking up P4 (EI-49)**: the `durable-objects` skill and
   `developers.cloudflare.com/durable-objects/best-practices/websockets/` —
   the hibernation API's exact method signatures are already verified and
   quoted in "P4 (EI-49) implementation plan" below, but re-verify against
   live docs before writing code anyway; training data on this API is
   commonly stale.

`.ai/todo.md` carries the previous agent's own review of the P3 semantics
work — worth skimming for the reasoning behind choices this doc only states.

---

## Status

| Piece | Linear | State |
|---|---|---|
| HLC (pure) | EI-47 | ✅ done, 21 tests |
| Field-level LWW merge, client | EI-47 | ✅ done, 11 tests |
| Real HLC wired into `mutate()`'s outbox stamp | EI-47 | ✅ done |
| DO SQLite schema + bootstrap + version counter | EI-46 | ✅ done |
| Field-level LWW, server half (pure) | EI-46 | ✅ done, 7 tests |
| DO `push`/`pull` RPC behind `/api/sync/*` | EI-46 | ✅ done |
| Outbox drain + `since=version` pull loop | EI-48 | ✅ done |
| DO wipe on account deletion | — | ✅ done |
| Settings sync | EI-60 | ✅ done |
| **WebSocket push + hibernation** | EI-49 (P4) | ❌ **not started — see "P4 (EI-49) implementation plan" below** |

**P3 (EI-46/EI-48) is done, including transport — see `.ai/todo.md`'s
"Review — P3 transport" for the phase-by-phase breakdown, what a live smoke
test against a real Durable Object confirmed, and what it couldn't reach
locally.** `UserDurableObject.fetch()` remains a stub — RPC (`push`/`pull`)
is the transport, and `fetch()` is deliberately left clean for P4's WebSocket
upgrade, which can only arrive there.

The merge-semantics-before-transport split was deliberate and held: the
transport built on top of `mergeRecord`/`applyIncomingPatch` without needing
to touch either. **Still do not redesign them for P4.** If a transport
decision seems to require changing merge semantics, that is a signal the
transport is wrong, not the semantics.

---

## The one decision to understand before touching anything (D2)

Field-level LWW needs to know *when each field* last changed. The client and
the server answer that question differently, on purpose.

**Client — derived from the outbox, never stored.** `mutate.ts` already writes
one outbox entry per mutation carrying `{entityId, patch, hlc}`, where `patch`
holds exactly the changed fields (§2.5). So a field's local clock is the `hlc`
of the newest *pending* entry whose patch mentions it. A field with no pending
entry is synced, and any remote change to it wins by definition. This means
**no per-row clock map and no Dexie migration** — see
`src/lib/sync/merge.ts`.

**Server — a real `field_clocks` table.** The DO has many writers and no
outbox, so it stores `(entity_id, field) -> hlc` explicitly. Decision logic
lives in `src/server/sync/apply-patch.ts`, deliberately pure so plain vitest
can test it.

Corollary the transport must respect: **an outbox entry must not be cleared
until the server has acknowledged it.** Clearing early destroys the local
field clock and silently converts "my unsynced edit wins" into "remote always
wins."

---

## Map of what exists

```
src/lib/sync/
  hlc-core.ts        pure HLC math, no globals — importable by worker code
  hlc.ts             re-exports hlc-core + getNodeId() (localStorage)
  merge.ts           mergeRecord(local, pending, remote) -> {apply, conflicts}
src/server/
  db/user-schema.ts  Drizzle schema for the DO's SQLite
  db/bootstrap.ts    hand-written DDL, run in the DO constructor
  sync/apply-patch.ts applyIncomingPatch(clocks, patch, hlc) -> {apply, clockUpdates, conflicts}
  user-do.ts         DO class; schema bootstrapped, fetch() still a stub
```

`hlc-core.ts` is split from `hlc.ts` for a real reason: `tsc` typechecks an
entire imported file under the *importing* project's `lib` config, so server
code importing `compareHlc` from `hlc.ts` would drag `getNodeId`'s
`localStorage` reference into the worker project, which has no `dom` lib.
Import `hlc-core` from anything under `src/server/`.

### Wire format, already fixed

HLC is `<phys:12 hex>:<counter:4 hex>:<nodeId>`, zero-padded so
**lexicographic string order equals causal order**. `compareHlc` is therefore
plain `<`/`>`, and the value sorts correctly as-is in an IndexedDB index or a
SQLite column. Don't parse it on a hot path, and don't change the padding.

### `since=version` pulls

Every entity table in the DO carries a monotonic `version` integer stamped
from the `sync_meta` singleton on each write. One global counter across all
kinds, so a client pull is "give me every row of every kind with
`version > cursor`". `sync_meta.next_version` is the allocator.

---

## What the next agent needs to do (EI-46 routes + EI-48) — ✅ done

Kept as the record of the plan that was followed — see `.ai/todo.md`'s
"Review — P3 transport" for what actually landed, file by file, and what a
live smoke test against a real Durable Object confirmed.

1. **Route `/api/sync/*` in `src/server/worker.ts`,** next to the existing
   `/api/auth/*` intercept. **Not a Next.js route handler** — `output: export`
   forbids route handlers that read `Request`, and the static build is the P7
   Capacitor guard (§2.12, §6). This is the same seam auth already uses; follow
   it exactly.
2. **Key the DO by the authenticated user id.** `createAuth(env, request)` is
   already there; get the session from the request, then
   `env.USER_DO.idFromName(session.user.id)`. Reject unauthenticated sync
   requests outright — **this is where real authorization lives.** The
   client-side nudges in §2.13 are presentation only and secure nothing.

   Corollary worth stating: the board is deliberately usable **signed out**
   (§2.13), so the sync layer must treat "no session" as a normal, permanent
   state — not an error to retry or a reason to nag. A logged-out user simply
   has no sync peer. Their data still lives in IndexedDB and must keep working
   untouched, and `adoptLocalData()` (§2.12) is what folds it into an account
   if they later sign up.
3. **Push:** drain outbox → POST → apply via `applyIncomingPatch` → return the
   new version → clear only acknowledged entries.
4. **Pull:** `GET ?since=<cursor>` → rows with `version > cursor` → merge each
   via `mergeRecord` → write through `mutate()`-adjacent paths → persist the
   cursor.
5. Trigger on window focus and an interval. Polling, deliberately — WebSockets
   are P4 and must be a transport swap against unchanged semantics. If P4 turns
   into a redesign, P3 got the conflict model wrong.

### Known traps

- **`FLOOR_HLC` must be populate-only, and the enforcement lives in
  `merge.ts`, not in the sort order.** A live incident, found by Rob two-
  browser testing this session, not caught by any test at the time: signing
  in on a second browser renamed every list to `"Untitled"` and orphaned them
  from their tab within ~30 seconds. `FLOOR_HLC` sorts below every real HLC
  by construction, but `mergeRecord`'s `remoteWins` check
  (`localHlc === null || compareHlc(...) > 0`) short-circuits on
  `localHlc === null` *before ever comparing clocks* — so "no pending local
  entry" let a `FLOOR_HLC` placeholder win outright, with zero HLC comparison
  involved. `merge.ts` now special-cases `remote.hlc === FLOOR_HLC`
  explicitly: it may fill in a field the local row doesn't already have a
  value for (`local[field] !== undefined`, not `Object.hasOwn`, not
  `local !== undefined` alone — a pre-tabs row's `undefined` `tabId` must
  still populate, and a present `null` must not be clobbered), never
  overwrite one it does. **If you ever add another sentinel HLC, it needs
  the same explicit carve-out — a low sort position alone is not a
  "loses to everything" guarantee**, since `mergeRecord`'s "no pending entry"
  branch never reaches the comparison at all.
- **The root cause was `seedIfEmpty()`/`ensureDefaultTab()` writing seed rows
  outside `mutate()`, with raw `db.put()` calls — now fixed.** Those rows had
  no outbox entry, ever, so their first-ever sync write was
  `adoptLocalData`'s later `{ownerId, updatedAt}` patch, which the server
  received as a genuinely partial create and synthesized `"Untitled"`
  placeholders for. `seedWrite()` (`src/lib/store/mutate.ts`) is the fix: one
  Dexie `put` plus one full-row outbox entry stamped at `SEED_HLC` — a new
  sentinel, strictly above `FLOOR_HLC` and strictly below every real HLC by
  construction. That means a fresh seed populates a genuinely empty server
  (`buildInsertColumns` never reached) and loses every field to any real
  edit on an established account — a second browser's fresh seed can never
  overwrite a renamed board. Verified in `round-trip.test.ts` against the
  real server pipeline. §2.5's "every write goes through `mutate()`, from
  day one" is now true in fact, not just intent — `resetLocalDataForNewOwner`
  is the one remaining, deliberate exception.
- **`repairDuplicateLists` is gone.** It hard-deleted (no tombstone, no
  outbox entry) any two live lists sharing a name — an ordinary, legal state,
  not just the seeding race it was written for — and its own tests asserted
  that destruction as intended behavior. It's what finished off the lists in
  the incident above, after the `FLOOR_HLC` bug had already renamed several
  to the same `"Untitled"` name. If you ever feel the pull to write a
  "cleanup pass" that runs on every boot and deletes rows outside `mutate()`,
  read this entry again first.
- **A wiped-in-place DO is a trap, not a recovery tool.** `ctx.storage.
  deleteAll()` resets `sync_meta.next_version` to 1, so every client's
  persisted `faite:sync-cursor:*` sits *above* every new version and sync
  goes silently dead on all devices. The same applies to clearing a device's
  IndexedDB without also clearing that localStorage key — the client is left
  stranded at a high watermark, believes it's synced, and never pulls again.
  If you ever need to reset an account's sync state, clear the cursor
  everywhere it's synced *before* or *as part of* whatever reset you run, or
  just use a new account (a new user id addresses a different, empty DO for
  free).
- **`settings` is device-local and excluded from ownerId adoption** (§2.12) —
  that part is permanent, not a P3 gap. Its Dexie primary key *is* `ownerId`,
  hardcoded to `LOCAL_OWNER_ID` app-wide, and always will be.
  **Field-level sync of an allow-listed subset now works (EI-60)** — see
  `SETTINGS_ENTITY_ID`/`SETTINGS_SYNCED_FIELDS` in `src/lib/sync/wire.ts`.
  `activeTabId` is excluded permanently (device view-state, and the
  highest-frequency writer via `board.tsx`'s tab switcher) — enforced on
  *both* directions server-side (`sanitizePatch` on push, `changesFromRow` on
  pull), not just in the client's drain, after a live smoke test found it
  otherwise rides along as `null` on every pull and can silently reset which
  tab is showing. Because settings has no `id` column (a true singleton,
  looked up by `owner_id` alone), it needed its own small branch in a few
  places rather than fitting the generic per-row-id machinery directly — see
  `.ai/todo.md`'s "Review — EI-60" for the full list.
- **Legacy outbox rows** written before the HLC swap hold plain ISO wall-clock
  strings. **They sort AFTER any real HLC** (`"2026-…"` > `"019f…"`
  lexicographically) — not before, as this doc previously and incorrectly
  said. That means an un-normalized legacy entry wins every LWW comparison it
  is ever compared in, forever, and `field_clocks` on the server cannot be
  repaired by a later client deploy once one lands there. Fixed at the source
  (`adopt-owner.ts` now uses `mutate.ts`'s real `enqueue`, not a hand-rolled
  `hlc: now()`) and by a one-time `normalizeOutboxHlcs()` migration
  (`src/lib/store/normalize-outbox.ts`) that must run — on every device —
  before the first drain. See `normalizeLegacyHlc` in `hlc-core.ts` and the
  regression test pinning the sort direction in `hlc.test.ts`.
- **`bootstrap.ts` is hand-maintained** against
  `drizzle/user/0000_*.sql`. There is no filesystem in a Workers bundle and no
  module rule for importing `.sql` as text, so the DDL is duplicated
  deliberately. After any `user-schema.ts` change, re-run
  `drizzle-kit generate --config=drizzle.user-do.config.ts` and hand-diff.
- **No `@cloudflare/vitest-pool-workers`.** Keep logic worth testing in pure
  helpers importable by plain vitest. Do not add the pool and restructure the
  test setup mid-task.
- **`wrangler deploy --dry-run` is the only check that actually bundles
  `worker.ts`.** Neither `npm run build` nor `build:static` does — they are
  pure Next builds. Add it to verification for any `src/server/` change.
- **Undo needs no special casing.** An undo is an ordinary forward `mutate()`
  and lands in the outbox like any other edit (§2.11). No revert opcode.
- **Deleting a user from D1 does not delete their Durable Object — ✅ fixed.**
  A DO is addressed by `idFromName(userId)` and has no foreign key to
  anything, so its storage would otherwise persist unreachable and paid for.
  `UserDurableObject.wipe()` (`ctx.storage.deleteAll()`) is now wired to
  Better Auth's `user.deleteUser.afterDelete` hook in `auth.ts`. **Unverified
  end-to-end**: the `/delete-user` endpoint's CSRF Origin check rejects any
  port not in `TRUSTED_ORIGINS`, which blocked exercising it against a local
  `wrangler dev` instance on a nonstandard port. The `ctx.storage.deleteAll()`
  call itself is a single, stable, documented platform API, so this is
  low-risk — but verify it once against `myfaite.app` or a branch preview
  with a disposable test account before leaning on it.

---

## Verification bar

```bash
npm run typecheck
npx vitest run
npm run build && npm run build:static     # static is the P7 guard
npx wrangler deploy --dry-run             # only thing that bundles worker.ts
```

`npm run lint` has one **pre-existing** failure in
`src/components/board/use-day-track.ts:156` unrelated to sync. That is the
known baseline; don't "fix" it.

**EI-48's acceptance is not a passing test.** It is Rob using Faite on two
machines for a week with no lost or duplicated data. The tests are necessary,
not sufficient.

---

## P4 (EI-49) implementation plan

Not started. This section is a concrete, actionable plan, not just
intent — written so a fresh agent with no memory of the P3 session can
execute it without re-deriving the design. It assumes you've read the
"Read first" list above, especially the P3 data-loss incident review in
`.ai/todo.md` — this work sits directly on top of `engine.ts`, `wire.ts`,
and `user-do.ts`, all of which that incident touched.

**The one rule that must hold at every step: this is a transport swap
against unchanged P3 semantics.** Same HLC, same `mergeRecord`, same
`applyIncomingPatch`, same `version` cursor, same `SyncTransport` interface
if at all possible. If implementing this seems to require changing merge
semantics, the merge semantics are not the problem — the transport design
is. Keep the polling path working as a fallback for blocked WebSockets
(corporate proxies, some VPNs); don't rip it out.

### Current API, verified against live Cloudflare docs (2026-08)

Do not trust training data here — the hibernation API has moved since most
models' cutoffs. Confirmed via `developers.cloudflare.com/durable-objects/
best-practices/websockets/` and the `durable-objects` skill this session:

```ts
// In the DO's fetch(), accepting a hibernatable socket (NOT ws.accept()):
async fetch(request: Request): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") { /* existing behavior */ }
  const pair = new WebSocketPair();
  this.ctx.acceptWebSocket(pair[1]); // hibernation-eligible — accept(), not this, would hold the DO in memory
  return new Response(null, { status: 101, webSocket: pair[0] });
}

// Called when the DO wakes from hibernation to handle a message —
// in-memory state (including `this.db`'s connection-scoped anything) is
// reset; the constructor reruns before this fires.
async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void>;
async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void>;
async webSocketError(ws: WebSocket, error: unknown): Promise<void>;

// All currently-connected sockets for this DO, survives hibernation:
this.ctx.getWebSockets(): WebSocket[];

// Per-connection state that survives hibernation (in-memory fields do not).
// Structured-cloneable, 16,384 byte cap. This is how the DO remembers
// which authenticated user a given socket belongs to after waking up.
ws.serializeAttachment(value: unknown): void;
ws.deserializeAttachment(): unknown;
```

Ping/pong is handled by the runtime automatically and does **not** wake the
DO or invoke `webSocketMessage` — no custom keepalive protocol needed.
`wrangler.jsonc`'s `compatibility_date` (currently `2026-08-01`) already
clears the `2026-04-07` threshold for auto-reply-to-close; no bump needed.

### Architecture: reuse `SyncTransport`, add one new capability

`engine.ts`'s `runSyncCycle` depends only on the `SyncTransport` interface
(`push(request)`, `pull(cursor, limit)`) — it has no idea whether that's
backed by `fetch()` or a socket. That's the seam. Plan:

1. **`src/lib/sync/ws-transport.ts`** (new) — a second `SyncTransport`
   implementation over a `WebSocket`, sending/receiving the *exact same*
   `PushRequest`/`PushResponse`/pull equivalents from `wire.ts`, wrapped in a
   small envelope so multiple message shapes can share one socket:
   ```ts
   type ClientMessage =
     | { id: string; type: "push"; payload: PushRequest }
     | { id: string; type: "pull"; payload: { cursor: number; limit: number } };
   type ServerMessage =
     | { id: string; type: "push-response"; payload: PushResponse }
     | { id: string; type: "pull-response"; payload: PullResponse }
     | { type: "changed" }; // unsolicited — no id, see below
   ```
   `id` correlates a response to its request (a `crypto.randomUUID()` per
   call, resolved via a `Map<string, {resolve, reject}>` — `runSyncCycle`
   never issues two concurrent push/pull calls itself, per `engine.ts`'s own
   coalescing, but the client shouldn't assume that invariant this deep in
   the stack). `push()`/`pull()` reject on socket close/error so the caller
   (`runSyncCycle`) sees a normal thrown error and its existing fault
   handling (this session's Phase 4 fix) applies unchanged.
2. **The one genuinely new capability: server-initiated push.** After a
   `push()` call causes a write, other devices connected right now should
   pull immediately, not wait up to 30s. In `user-do.ts`'s `push()`, after
   the `transactionSync` commits, iterate `ctx.getWebSockets()` and
   `ws.send(JSON.stringify({type: "changed"}))` to every socket **except**
   the one that just pushed (compare `ws.deserializeAttachment()`'s
   connection id, or simply exclude by object identity if the push itself
   arrived over this same socket — see the dual-path note below).
   `ws-transport.ts` exposes this as an `onRemoteChange` callback;
   `engine.ts`/`sync-provider.tsx` wires it to `runner.runSync()` directly
   (a stronger trigger than the existing debounced `notifyLocalChange`,
   since this one has no local write of its own to explain away).

### Server-side plan

- **`worker.ts`** — add `/api/sync/ws` (or branch inside the existing
  `/api/sync` prefix on the `Upgrade` header) *before* the pull/push routes.
  Authenticate exactly like `routes.ts` already does
  (`createAuth(env, request).api.getSession()`), 401 on failure — a
  WebSocket upgrade request is still an ordinary HTTP request until the 101
  response, so the existing session-cookie check works unchanged. On
  success, forward via `stub.fetch(request)` — `DurableObjectStub` supports
  `.fetch()` alongside RPC methods; this is how the upgrade actually reaches
  the DO. **Do not try to authenticate inside the DO** — it has no route to
  Better Auth's D1-backed session store, and shouldn't need one; the worker
  is where auth already lives (ARCHITECTURE §2.12).
- **`user-do.ts`** — `fetch()` stops being a stub:
  - Branch on `Upgrade: websocket`. On accept, immediately
    `ws.serializeAttachment({ userId })` — the userId comes from... it
    doesn't, not directly. `stub.fetch(request)` doesn't carry the
    worker's already-verified `userId` through to the DO's `fetch()`
    automatically. Pass it explicitly: either a short-lived signed token in
    the upgrade URL's query string (`/api/sync/ws?token=...`) that the DO
    can't itself verify but doesn't need to (the DO trusts whatever
    `idFromName(userId)` already scoped it to — the DO *is* already
    user-scoped by construction, it just needs the value for `owner_id` on
    inserts), or — simpler — since the DO is already addressed by
    `idFromName(session.user.id)`, the DO can resolve its **own** identity
    by storing `userId` once via a tiny `init(userId)` RPC call the worker
    makes on first connect, alongside or instead of threading it through
    the URL. Decide this early; it affects both `webSocketMessage`'s access
    to `userId` and whether `push()`'s existing `userId` parameter can be
    dropped in favor of a stored one. (`push`/`pull`'s RPC signatures
    currently take `userId` as an explicit argument specifically because
    the DO doesn't otherwise know it — same question applies here.)
  - `webSocketMessage(ws, message)` — parse the envelope, dispatch to the
    **existing** `push()`/`pull()` method bodies (refactor them so the RPC
    methods and the WS handler both call the same internal function — do
    not duplicate the push/pull logic between the RPC path and the
    WebSocket path, that's exactly the kind of drift this session's
    incident review warns about). Reply with the correlated `id`.
  - After a successful `push()` with real writes, broadcast `{type:
    "changed"}` to every other open socket (see above).
  - `webSocketClose`/`webSocketError` — no state to clean up beyond
    whatever bookkeeping the attachment held; sockets are removed from
    `ctx.getWebSockets()` automatically.

### Client-side plan

- **`src/lib/sync/ws-transport.ts`** (new) — connects to `/api/sync/ws`
  (relative URL, same pattern as `transport.ts`'s `httpTransport` — cookies
  ride along on the WebSocket handshake automatically for same-origin;
  verify this holds for the cross-origin dev/Capacitor case, since the
  native `WebSocket` constructor has no `credentials` option the way
  `fetch()` does). Implements `SyncTransport`. Reconnects with backoff on
  close/error; after N consecutive failures (a small, explicit constant —
  don't let this creep past a few seconds total), stops retrying for this
  session and lets the caller fall back to polling.
- **`engine.ts`** — `createSyncEngine` picks `ws-transport` when connected,
  `httpTransport` otherwise; `runSyncCycle` itself needs **zero changes**
  if the interface boundary held. The visible-only jittered interval
  (currently 30s) can relax to a much longer safety-net cadence once a
  WebSocket is live — live push should catch everything, the interval
  becomes a "just in case the socket lied about being open" backstop, not
  the primary mechanism. Wire the new `onRemoteChange` callback to an
  immediate `runner.runSync()`, not through the existing debounced
  `notifyLocalChange` (that debounce exists to coalesce *local* writes
  before pushing; a remote-change signal has no local write to wait for).
- **`sync-provider.tsx`** — construct whichever transport(s) the engine
  needs and pass them through; otherwise unchanged. The `isActive()` gate
  (`getBoundOwnerId() === session.user.id`) applies identically — do not
  let a WebSocket connect before that gate passes, for the same reason
  polling doesn't: it would leak one account's writes into another's DO
  during the account-switch confirmation window.

### Testing

Same discipline as P3, and for the same reason: `@cloudflare/vitest-pool-
workers` stays banned, so a real hibernating DO and a real browser
`WebSocket` are both untestable in plain vitest. Split accordingly:

- **Pure and unit-testable**: the envelope encode/decode, the
  request-id correlation map, the reconnect/backoff state machine (as a
  pure function of `(attempt, lastError) -> delay | "give up"`, not
  entangled with a real socket), and — if `push()`/`pull()`'s bodies get
  extracted into shared internal functions as recommended above — nothing
  new to test there, since `push.ts`/`pull.ts`'s existing pure functions
  already cover the logic regardless of which transport invoked them.
- **Needs a live two-browser test, not a unit test**: the actual hibernation
  round trip (does a message arriving after real hibernation correctly
  rehydrate `userId` via `deserializeAttachment`?), the broadcast-on-write
  reaching a second real tab within the same session, and reconnect
  behavior against a real dropped connection (DevTools → Network →
  offline/online, same pattern as the P3 smoke test). Do this on an
  isolated `wrangler dev` port, `ps`-checked first, never touching a
  developer's already-running instance — see `.ai/lessons.md` and the P3
  smoke-test commits for the exact pattern to repeat.
- Verification bar unchanged: `npm run typecheck` (both projects),
  `npx vitest run`, `npm run build && npm run build:static`,
  `npx wrangler deploy --dry-run` for any `src/server` change (this phase
  touches `worker.ts` and `user-do.ts`, so every commit needs it).

### Suggested phase/commit breakdown

Mirrors the P3 pattern: small, independently-verified commits, in this
order because each depends on the previous one existing:

1. Wire envelope types (`wire.ts` additions) + the shared internal
   push/pull functions `user-do.ts`'s RPC methods and the future WS handler
   will both call — no behavior change yet, RPC still the only caller.
2. `user-do.ts`'s `fetch()` upgrade + `webSocketMessage`/`webSocketClose`/
   `webSocketError`, `worker.ts`'s `/api/sync/ws` route. No client changes
   yet — verify with a manual WS client (`wscat`, or a scratch script) 
   before writing any browser code.
3. `ws-transport.ts` + `engine.ts` dual-transport wiring + reconnect/
   backoff. This is the phase that needs the two-browser live test.
4. Broadcast-on-write + the `onRemoteChange` immediate-trigger path. Live
   two-browser test again — this is the actual point of P4, verify it
   directly (edit on device A, watch it arrive on device B without
   touching device B).
5. Relax the polling interval now that live push is proven; docs update.

---

## Environment as of this handoff

- Live at **https://myfaite.app** (custom domain; `workers.dev` is disabled).
- **Auth is complete and verified against production D1** — GitHub, Google, and
  email/password all confirmed, plus the full signup → verify → sign-in loop.
  `createAuth(env, request)` derives its `baseURL` from the request origin, so
  it works on production, branch previews, and localhost alike — **follow the
  same pattern for sync routes rather than hardcoding a host.** Email
  verification is required everywhere except localhost, because the
  `send_email` binding does not deliver under local `wrangler dev`.
- Bindings on the `faite` Worker: `USER_DO`, `AUTH_DB` (D1), `EMAIL`, `ASSETS`.
- CI: Workers Builds deploys `main` on push, and branch previews are live at
  `*-faite.bfmw-dev.workers.dev` (both `preview_urls: true` in
  `wrangler.jsonc` and "Builds for non-production branches" in the dashboard
  are on — it needs both).
- **Production D1 holds exactly one user**, `rob@roberskine.com`, with both a
  `github` and a `credential` account row under one user id — Better Auth
  links providers that share a verified email. Test accounts were deleted; if
  you add more while developing, clean up after yourself, since the DO for a
  deleted user id is left orphaned (see below).

**What this means for you:** a real, authenticated `session.user.id` is
available on every request now. That is what keys the per-user Durable Object
(`env.USER_DO.idFromName(session.user.id)`), and it is the thing P3 was
waiting on. There is no remaining auth blocker.

Note that **OAuth users and password users differ in one way that matters**:
OAuth accounts arrive `email_verified: 1`, `credential` accounts only after
clicking the link. If sync ever needs to gate on verification, read the field —
do not infer it from the provider.

### Verifying against production

The D1 auth tables are queryable through the Cloudflare API without touching
the app, which is how everything above was confirmed:

```
POST /accounts/{account_id}/d1/database/{database_id}/query   { "sql": "..." }
database_id: d0be89ae-e45d-44f4-804f-7f88a2f169fa   (faite-auth)
```

The DO's SQLite is **not** reachable this way — a Durable Object's storage has
no external query endpoint. Once sync routes exist, expose a debug read
through the DO itself if you need to inspect it, and remember that gap when
planning how to debug a two-machine divergence.
