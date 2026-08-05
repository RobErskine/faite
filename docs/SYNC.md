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
4. `AGENTS.md` loads automatically via `CLAUDE.md`. Heed it: this is Next.js
   16 with real breaking changes, and `node_modules/next/dist/docs/` is the
   source of truth over anything remembered.

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
| **WebSocket push + hibernation** | EI-49 (P4) | ❌ **not started** |
| **Settings sync** | — | ❌ **deliberately excluded from P3** |

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

- **`settings` is device-local and excluded from ownerId adoption** (§2.12), and
  **P3 excludes it from sync entirely** — `kind === "settings"` outbox entries
  are dropped in the drain and deleted locally (`src/lib/sync/drain.ts`),
  since `board.tsx`'s tab switcher writes one on every tab change and keeping
  unackable entries would grow the outbox without bound. Its Dexie primary key
  *is* `ownerId`, hardcoded to `LOCAL_OWNER_ID` app-wide, so "one settings row
  per device" still hasn't survived sync — see `.ai/todo.md`'s "Please review:
  settings excluded from sync" for the cost (the `fontPairing`/`theme`
  cross-device promise in `schema.ts` doesn't hold yet) and the sketched fix.
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

## P4 (EI-49) — what to preserve

WebSocket push with hibernation is a **transport swap against unchanged P3
semantics**: same HLC, same `mergeRecord`, same `applyIncomingPatch`, same
`version` cursor. Keep the polling path as a fallback for blocked WebSockets.
Hibernation is why the DO was chosen over shared D1 in the first place (§2.9),
so use the hibernation API rather than holding connections open.

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
