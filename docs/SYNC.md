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
6. **If you're touching the WebSocket path (P4/EI-49)**: read
   "P4 (EI-49) — WebSocket live push, shipped" below, then
   `scripts/sync-smoke/README.md`. The hibernation API has moved since most
   models' cutoffs — re-verify against
   `developers.cloudflare.com/durable-objects/best-practices/websockets/`
   rather than trusting training data, and re-run all three smoke harnesses
   after any change to `user-do.ts`, `routes.ts`, `ws-server.ts`, or
   `ws-protocol.ts`. Two of the traps listed there are invisible to the unit
   suite by construction.

7. **If you are changing any entity's fields — adding, renaming, removing, or
   adding a whole new kind — read `docs/SCHEMA-CHANGES.md` FIRST.** A field is
   declared in four places and derived in three more, and the DO's storage
   needs a real migration (`src/server/db/migrations.ts`) that
   `bootstrap.ts` alone cannot provide. Skipping it breaks push permanently
   for every account that already has data.

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
| WebSocket live push + hibernation | EI-49 (P4) | ✅ done — see "P4 (EI-49) — WebSocket live push, shipped" |
| Bound-param chunking + `wipe()` hardening | — (P4 phase 0) | ✅ done |

**P3 (EI-46/EI-48) is done, including transport — see `.ai/todo.md`'s
"Review — P3 transport" for the phase-by-phase breakdown, what a live smoke
test against a real Durable Object confirmed, and what it couldn't reach
locally.** `UserDurableObject.fetch()` is no longer a stub — it is where P4's
WebSocket upgrade arrives, and the only thing it does. `push`/`pull` remain
RPC, because the worker already owns HTTP.

The merge-semantics-before-transport split was deliberate and held twice
over: P3's transport built on `mergeRecord`/`applyIncomingPatch` without
touching either, and **P4 then swapped the transport again — to WebSockets —
with those files, `wire.ts`'s types, and the `version` cursor all completely
untouched.** That was the real test of the conflict model, and it passed.
**Still do not redesign them.** If a transport
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
  wire.ts            push/pull wire types, DOM-free
  ws-protocol.ts     P4 socket envelope + close codes, DOM-free
  pending-requests.ts P4 request/response correlation + timeout policy
  ws-transport.ts    P4 SyncConnection over a browser WebSocket
  fallback-transport.ts  per-call routing: socket when open, HTTP otherwise
  backoff.ts         P4 reconnect ladder, pure
src/server/
  db/user-schema.ts  Drizzle schema for the DO's SQLite
  db/bootstrap.ts    hand-written DDL — the INITIAL schema only
  db/migrations.ts   ordered, ledgered migrations — REQUIRED for any column
                     added after an account already exists
  sync/apply-patch.ts applyIncomingPatch(clocks, patch, hlc) -> {apply, clockUpdates, conflicts}
  sync/validate.ts   parsePushRequest/clampPullArgs — shared by HTTP AND ws
  sync/ws-server.ts  USER_ID_HEADER + isAllowedWsOrigin (the CSWSH check)
  sync/sql-limits.ts chunkForInClause — SQLite's 100-bound-param ceiling
  user-do.ts         DO class; RPC push/pull + WebSocket upgrade + broadcast
scripts/sync-smoke/  node harnesses: real DO, real socket, real hibernation
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

## P4 (EI-49) — WebSocket live push, shipped

Live push works: a write on one device reaches the others in about a second,
over a hibernatable WebSocket to the per-user Durable Object, with HTTP
polling kept as a live fallback.

It held to the rule it was given — **a transport swap against unchanged P3
semantics**. Nothing in `merge.ts`, `apply-patch.ts`, `hlc-core.ts`,
`wire.ts`'s types, or the `version` cursor changed. `SyncTransport` is still
the same two methods. `runSyncCycle` is byte-identical. That was the test of
whether P3 got the conflict model right, and it passed.

### What landed

```
src/lib/sync/
  ws-protocol.ts        envelope types + encode/decode, DOM-free, no zod
  pending-requests.ts   request/response correlation, timeout policy
  ws-transport.ts       SyncConnection: the socket, reconnect, isReady()
  fallback-transport.ts per-call routing between socket and HTTP
  backoff.ts            nextDelay/shouldPause/nextAttempt, pure
src/server/sync/
  ws-server.ts          USER_ID_HEADER, isAllowedWsOrigin (the CSWSH check)
  validate.ts           parsePushRequest/clampPullArgs, shared by BOTH paths
  sql-limits.ts         chunkForInClause + the 100-bound-param ceiling
scripts/sync-smoke/     node harnesses driving a real DO over a real socket
```

Modified: `user-do.ts` (`fetch()` upgrade, the three hibernation handlers,
broadcast in `push()`, `wipe()` hardening), `routes.ts` (`/api/sync/ws`),
`engine.ts` (`notifyRemoteChange()`, adaptive interval),
`sync-provider.tsx` (wiring).

### Decisions that differ from the pre-implementation plan

The plan this section replaces was written before the work started. Five
things changed once the code was real. All five are argued in the source; the
short version:

1. **`userId` reaches the DO as a request header** (`X-Faite-User-Id`), not a
   signed URL token and not an `init(userId)` RPC. The `USER_DO` namespace is
   reachable only from this Worker, so a header the Worker sets is exactly as
   trustworthy as an RPC argument, and it costs no extra round trip.
2. **`push`/`pull` were NOT extracted into shared internal functions.** They
   are ordinary methods; RPC is merely an additional exposure, so
   `webSocketMessage` calls `this.push(...)` directly. The thing that
   genuinely needed sharing was `routes.ts`'s **validation** — that is
   `validate.ts`, and without it the socket path would have handed `pull()`
   an unclamped `LIMIT` across six kinds.
3. **`onRemoteChange` goes through `trigger()`, not `runner.runSync()`.**
   `runSync()` bypasses both the `isActive()` gate and the `faite:sync` Web
   Lock, and both still apply to a remote change. Only the debounce should
   not.
4. **`changed` carries a `version`.** Sibling tabs share one IndexedDB, so
   without it every push costs a redundant pull per open tab.
5. **An `Origin` check on the upgrade.** The original plan had none. See
   below — this is the important one.

### Traps found doing this work

- **A WebSocket handshake bypasses CORS completely.** It is sent with
  cookies, with no preflight, and `Access-Control-Allow-Origin` has no say in
  whether it is established. So `/api/sync/ws` needs its own `Origin` check
  (`isAllowedWsOrigin`), and that check is the only thing between evil.com
  and a signed-in board — nothing else in the codebase does this job, because
  until P4 every sync request went through `fetch`, which CORS does govern.
  It accepts **same-origin OR `TRUSTED_ORIGINS`**: the same-origin clause is
  not a convenience, it is what stops branch previews
  (`*-faite.bfmw-dev.workers.dev`, deliberately absent from the allow-list)
  from 403ing their socket while HTTP sync keeps working — a failure that
  presents as "hibernation is broken".
- **SQLite in a DO allows only 100 bound parameters per query**, and
  `readFieldClocksBulk` built one `IN (?, …)` over the union of every kind's
  page — up to 600 at `DEFAULT_PULL_LIMIT`, 1200 at `MAX_PULL_LIMIT`. It was
  latent only because the account is small, and it would have fired first on
  a `since=0` or long-offline catch-up: precisely what reconnect depends on.
  Fixed in `sql-limits.ts`. **Rule: if the number of `?`s in a query depends
  on an array's length, it must be chunked.**
- **`wipe()` used to leave the object alive with no schema.** `deleteAll()`
  drops the tables, but the constructor's `blockConcurrencyWhile` bootstrap
  has already run and will not run again until a cold start. Latent before
  P4 because the D1 user row was gone by then and nothing could authenticate
  back in — a live socket is exactly what removes that protection. `wipe()`
  now closes sockets, deletes, and re-bootstraps.
- **A throw out of `webSocketMessage` is not a local failure.** It can leave
  the stub broken for *every* socket attached to the object, so one tab's
  malformed frame can disconnect a different device. `webSocketMessage` is
  total by construction, and `decodeClient`/`decodeServer` return `null`
  rather than throwing. `smoke.mjs` pins this with a second concurrent
  socket, which is the assertion that actually matters.
- **A timeout has to close the socket, not just fail the call.** A zombie
  socket keeps `readyState === OPEN` long after a laptop sleeps or a phone
  changes network. Treating a timeout as one failed call leaves every later
  push and pull paying the full timeout inside `runSyncCycle`'s
  `while (hasMore)` loop — a wedged engine, not a fallback.
- **"Give up and stay on polling for the session" is too brittle.** A closed
  lid, a subway ride, or a `wrangler deploy` (which disconnects every socket
  on every DO) burns the whole retry ladder in seconds against a network
  that isn't there. `shouldPause` stops the *timer loop*; `online` and
  `visibilitychange` reset the ladder and re-arm.
- **Idle DO eviction is a 70–140s window.** "Open two tabs and edit" proves
  broadcast and proves nothing about hibernation. `hibernate.mjs` idles 170s
  and then pushes, because `owner_id` on that insert can only come from
  `deserializeAttachment()` after the constructor re-ran.
- **`setInterval` cannot re-read its own delay.** The engine's interval is
  now a self-rescheduling `setTimeout`, so connecting a socket actually
  relaxes the cadence (30s → 120s) instead of waiting for the next
  visibility change, and the jitter is recomputed per tick rather than once
  per arming.
- **curl writes httpOnly cookies with a `#HttpOnly_` prefix.** Filtering out
  lines starting with `#` — the obvious way to skip comments in a cookie jar
  — drops exactly the session cookie, and every request 401s in a way that
  looks like an auth bug. Cost 15 minutes in the smoke harness.

### Known limits, deliberately accepted

- **A socket authenticates once, at the handshake.** The HTTP path
  re-authenticates on every request. `MAX_SOCKET_AGE_MS` (1 hour) bounds the
  window in which a socket outlives a sign-out elsewhere or a session
  expiry; the DO is `idFromName(userId)`-scoped, so the worst case is the
  same user's stale credential writing to their own board, never a
  cross-account leak. Bounded rather than eliminated, on purpose — a
  per-message session check would mean a D1 round trip per frame.
- **`next dev` cannot use the socket**, exactly as `/api/sync/*` already
  404s there. The fallback covers it. This is why give-up must be quiet.
- **Capacitor (P7) will stay on HTTP.** The `WebSocket` constructor has no
  `credentials` option, so cookies follow SameSite with no override, and
  `capacitor://localhost` → `myfaite.app` is cross-site. Unverified but very
  likely; the fallback makes it a non-event either way.
- **One socket per tab**, no SharedWorker and no leader election.
  SharedWorker is unavailable in iOS Safari and would be dead weight for
  P7. Sockets are cheap (32,768 per DO, no duration billing while
  hibernating), the `faite:sync` Web Lock already dedupes cycles, and the
  `version` on `changed` removes the redundant-pull cost that made per-tab
  sockets look expensive.

### Testing

Same split as P3, same reason. `@cloudflare/vitest-pool-workers` stays
banned, so everything decidable was pushed into pure modules and unit-tested
(the envelope, the correlation map and its timeout policy, the backoff
ladder, the origin check, the validators, the chunker), and what remains —
a real hibernating DO, a real socket — is covered by `scripts/sync-smoke/`.
See that directory's README; re-run all three after touching `user-do.ts`,
`routes.ts`, `ws-server.ts`, or `ws-protocol.ts`.

**Still Rob's to confirm:** two real browsers on two machines. The harnesses
prove the protocol; they cannot prove the board.
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
