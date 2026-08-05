# Sync — P3/P4 handoff

State of the sync work, what is settled, and what the next agent should and
should not do. Read `docs/ARCHITECTURE.md` §2.4–§2.7 and §2.12–§2.13 first;
this doc assumes them.

---

## Status

| Piece | Linear | State |
|---|---|---|
| HLC (pure) | EI-47 | ✅ done, 14 tests |
| Field-level LWW merge, client | EI-47 | ✅ done, 11 tests |
| Real HLC wired into `mutate()`'s outbox stamp | EI-47 | ✅ done |
| DO SQLite schema + bootstrap + version counter | EI-46 | ✅ done |
| Field-level LWW, server half (pure) | EI-46 | ✅ done, 7 tests |
| **DO RPC / fetch routes** | EI-46 | ❌ **not started** |
| **Outbox drain + `since=version` pull** | EI-48 | ❌ **not started** |
| WebSocket push + hibernation | EI-49 (P4) | ❌ not started |

**The semantics are finished and tested. None of the transport exists.**
`UserDurableObject.fetch()` is still a stub returning a JSON note, and no
client code opens a network connection for sync.

That split was deliberate: the merge rules are the part that must be right the
first time (EI-47), so they were built and pinned by tests before any wire
format could bake assumptions into them. **Do not redesign them.** If a
transport decision seems to require changing merge semantics, that is a signal
the transport is wrong, not the semantics.

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

## What the next agent needs to do (EI-46 routes + EI-48)

1. **Route `/api/sync/*` in `src/server/worker.ts`,** next to the existing
   `/api/auth/*` intercept. **Not a Next.js route handler** — `output: export`
   forbids route handlers that read `Request`, and the static build is the P7
   Capacitor guard (§2.12, §6). This is the same seam auth already uses; follow
   it exactly.
2. **Key the DO by the authenticated user id.** `createAuth(env)` is already
   there; get the session from the request, then
   `env.USER_DO.idFromName(session.user.id)`. Reject unauthenticated sync
   requests outright — **this is where real authorization lives.** The
   client-side nudges in §2.13 are presentation only and secure nothing.
3. **Push:** drain outbox → POST → apply via `applyIncomingPatch` → return the
   new version → clear only acknowledged entries.
4. **Pull:** `GET ?since=<cursor>` → rows with `version > cursor` → merge each
   via `mergeRecord` → write through `mutate()`-adjacent paths → persist the
   cursor.
5. Trigger on window focus and an interval. Polling, deliberately — WebSockets
   are P4 and must be a transport swap against unchanged semantics. If P4 turns
   into a redesign, P3 got the conflict model wrong.

### Known traps

- **`settings` is device-local and excluded from ownerId adoption** (§2.12). Its
  Dexie primary key *is* `ownerId`, hardcoded to `LOCAL_OWNER_ID` app-wide.
  "One settings row per device" was never going to survive sync unchanged, and
  P3 needs its own answer. Do not naively sync it.
- **Legacy outbox rows** written before the HLC swap hold plain ISO wall-clock
  strings. They sort before any real HLC. Harmless today because nothing has
  ever drained the outbox — but the first drain will encounter them on a
  long-lived local database.
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
- Auth is **live and working** — GitHub OAuth and email/password both verified
  against production D1. Google is configured but was not exercised.
- Bindings on the `faite` Worker: `USER_DO`, `AUTH_DB` (D1), `EMAIL`, `ASSETS`.
- CI: Workers Builds deploys `main` on push. `preview_urls: true` is set in
  `wrangler.jsonc`, but **"Builds for non-production branches" is currently
  off** in the dashboard, so branch previews do not run yet.
- `REQUIRE_EMAIL_VERIFICATION` in `src/server/auth.ts` is still `false`.
