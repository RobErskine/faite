# Faite — build todo

Plan of record: `~/.claude/plans/please-check-this-image-starry-eich.md`

## P0 — Scaffold + deploy ✅

- [x] Next.js 16.2.12 + React 19.2.4, TypeScript, App Router, `src/` dir
- [x] `@opennextjs/cloudflare` 1.20.2 + wrangler 4.118.0
- [x] Custom worker entry exporting the Durable Object (`src/server/worker.ts`)
- [x] `UserDurableObject` skeleton + `v1` SQLite migration declared
- [x] Dual build target (Workers + `output: export` for Capacitor)
- [x] CI guard keeping the static build green (`.github/workflows/ci.yml`)
- [x] Deployed: https://faite.bfmw-dev.workers.dev

## P1 — Local main loop (no backend)

- [x] Zod schema: todos, lists, labels, projects (`src/lib/schema.ts`)
- [x] `deriveColumn()` + timezone + workday rollover (`src/lib/scheduling.ts`)
- [x] Fractional indexing helpers (`src/lib/ordering.ts`)
- [x] **`mutate()` single write path + outbox** (`src/lib/store/mutate.ts`) — load-bearing for P3
- [x] IndexedDB local store (Dexie) + reactive hooks
- [x] CRUD repositories for todos, lists, labels, projects
- [x] Calendar half (day columns + Overflow)
- [x] Planning half (list columns, Backlog undeletable)
- [x] dnd-kit: reorder within column + drag across halves
- [x] Quick add (inline per column) + ⌘K command palette
- [x] Todo detail sheet (full CRUD)
- [x] Column min/max width (`--column-min` / `--column-max`) + a horizontally
      scrolling column track on both halves, with a persistently drawn bar
- [x] Planning columns 50px wider than day columns (`--list-column-min`)
- [x] "Create list" card at the end of the planning track
- [x] 47 unit tests: scheduling, ordering, board grouping

### Still open in P1
- [ ] Browser-verify the board interactively (blocked on Chrome extension
      permission prompt at time of writing)
- [ ] Keyboard drag-and-drop pass — dnd-kit sensors are wired, but the
      end-to-end keyboard reorder flow has not been exercised
- [ ] Empty-state polish when every column is empty

## P2 — Auth ✅ (code) / ⏳ (live)

- [x] `wrangler d1 create faite-auth` + binding
- [x] Better Auth, **per-request factory** (`src/server/auth.ts`, `createAuth(env)`)
- [x] Mounted in `src/server/worker.ts` (`/api/auth/*`), not a Next route —
      `output: export` forbids Route Handlers reading `Request`
- [x] Email/password, GitHub OAuth, Google OAuth (widened from EI-45's
      GitHub-only scope, and pulled Google forward out of P6/EI-58)
- [x] D1 + Drizzle adapter; schema generated (`npm run auth:schema`), migrated
      local + remote
- [x] Password reset + verification email via Cloudflare Email Service
      (`src/server/email.ts`) — inert until `myfaite.app` DNS + `wrangler email
      sending enable` (see below), falls back to console logging until then
- [x] `requireEmailVerification` wired but **left `false`** until mail can send
- [x] Login/signup/forgot-password/reset-password/verify-email pages
- [x] Header wired to the real session (`app-header.tsx`)
- [x] One-time `ownerId` adoption on first sign-in (`adopt-owner.ts`,
      `owner.ts`) + different-account conflict handling — see ARCHITECTURE §2.12
- [x] `npm run typecheck`, `npm run test` (239 passing), `npm run build`,
      `npm run build:static` all green
- [ ] **Blocked on Rob**: point `myfaite.app` DNS at Cloudflare, register the
      GitHub/Google OAuth apps (in that order), set secrets
      (`BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`)
- [ ] Flip `REQUIRE_EMAIL_VERIFICATION` to `true` once the above lands
- [ ] Deploy + verify a real OAuth round trip against the live callback

## P3 — Sync v0 (two-machine sync goal)

- [x] HLC (`src/lib/sync/hlc.ts` / `hlc-core.ts`) — encode/decode, local/receive
      events, counter overflow, `getNodeId()`
- [x] Field-level LWW merge (`src/lib/sync/merge.ts`, `mergeRecord`) — the
      two-devices-different-fields acceptance test is written and passing
- [x] `mutate.ts`'s outbox `hlc` stamp is a real HLC now, not wall-clock ISO
- [x] DO SQLite schema + Drizzle (`drizzle(ctx.storage)`) — entity tables,
      `field_clocks` (server-side per-field HLC), `sync_meta` (version
      counter); bootstrapped in `user-do.ts`'s constructor. **Schema/migration
      only** — see Review below
- [x] Server-side per-field apply decision (`src/server/sync/apply-patch.ts`,
      pure, mirrors `mergeRecord`), now wired to the DO's storage
- [x] DO `push`/`pull` RPC behind authenticated `/api/sync/*` routes (EI-46)
- [x] Outbox drain, `since=version` pull loop, focus/online/interval/local-
      write triggers (EI-48) — see Review below
- [x] `UserDurableObject.wipe()` wired to Better Auth's
      `user.deleteUser.afterDelete` — the orphaned-DO trap from the P2/P3
      handoff doc, closed rather than deferred again
- [x] `settings` field-level sync, allow-listed (EI-60) — see Review
- [x] Data-loss incident (`FLOOR_HLC` overwriting real values via
      raw-`put()` seed writes, finished off by `repairDuplicateLists`'
      hard delete) found in Rob's own two-browser test, fixed same
      session — see "Review — data-loss incident" below

## P4 — Sync v1 ✅ shipped to production
- [x] WebSocket push, hibernation, reconnect/backfill, multi-tab (EI-49)
  — see Review below. Transport swap only: `merge.ts`, `apply-patch.ts`,
  `hlc-core.ts`, `wire.ts`'s types and the `version` cursor all untouched.
- [x] Phase 0 hardening found on the way in: `readFieldClocksBulk` exceeded
  SQLite's 100-bound-parameter limit; `wipe()` left the DO with no schema.
- [x] **Rob's two-browser acceptance test — passed.** That was the real bar;
  the smoke harnesses only ever proved the protocol.
- [x] Merged and deployed: `23675ce..3bed126` (15 commits — 8 P4 plus the 7
  P3 data-loss fixes that had never reached production). Cloudflare version
  17 (`3b7e83fa`), 2026-08-06 15:07 UTC. Live at https://myfaite.app

## P5 — API + docs
- [ ] Zod → OpenAPI, tokens, rate limits (EI-50) — **read `docs/API.md`
  first.** The load-bearing constraint: a REST/MCP write is not a database
  write, it is a *push*. Skip `sync_meta`'s version allocation and no device
  ever pulls the change; skip `field_clocks` and the next client push
  silently overwrites it. Route through `user-do.ts`'s `push()` and P4's
  live broadcast comes free.
- [ ] Decide who stamps the HLC for a server-originated write — the DO needs
  a stable server node id, which does not exist yet.
- [ ] Ship read-only endpoints first; reads need no version and no clocks.

### Schema/data-shape work (ongoing, alongside P5/P6)
- [x] DO migration runner (`src/server/db/migrations.ts`) — ledgered,
  transactional, ordered. Verified against a real DO that already had data.
- [x] `docs/SCHEMA-CHANGES.md` — the seven files a field lives in.
- [ ] **Every** field addition from here needs a migration entry. Adding a
  column to `user-schema.ts` alone breaks push permanently for any account
  that already has data.

## P6 — Fast follow
- [ ] Projects + views · sub-tasks · recurrence (RRULE + exceptions)
- [x] Priority 1–4 — editable since P1/P2, now also visible on the card (chip,
      pulled forward as EI-56's tail)
- [x] List tabs (pulled forward — grouping, color, drag-sort, cross-tab carry)
- [x] Location — editable since P1/P2, now also visible on the card (chip)
- [ ] Markdown descriptions — punted on purpose; dropped the "Markdown
      supported" placeholder promise instead of adding a dependency (EI-56,
      unattended-session call, see Review below)
- [ ] Search/saved views · icon upload
- [ ] Magic-link auth (Google moved into P2)

## P7 — Capacitor + MCP

## Review — P0

Scaffolded in place so the pre-existing `.git` was preserved. Three things
that were not obvious up front and are now encoded in the repo:

1. `next.config.ts` is loaded via `require()`, so **top-level `await` breaks it**.
   `initOpenNextCloudflareForDev` must be a static import.
2. `src/server` is excluded from the Next tsconfig and typechecked by
   `tsconfig.worker.json` instead — it uses `cloudflare:workers` types that the
   Next build does not have, and imports a bundle that only exists post-build.
3. The `open-next/worker` specifier needs **two** aliases that must stay in sync:
   `paths` in `tsconfig.worker.json` (for tsc) and `alias` in `wrangler.jsonc`
   (for the bundler). Wrangler's error message points this out explicitly.

## Review — P2

Built against a repo with concurrent, uncommitted work in flight (a
profile/avatar/theme settings feature) — re-surveyed `app-header.tsx`,
`schema.ts`, and `repositories.ts` mid-task rather than trusting the earlier
plan-mode read, which had gone stale. Three things worth keeping:

1. **`wrangler types` output can contaminate the main tsconfig.** The
   generated `cloudflare-env.d.ts`'s `mainModule` field is
   `typeof import("./src/server/worker")`, which drags the Workers-only
   `open-next/worker` import into any tsconfig that includes the `.d.ts` —
   including the main one, since it lives at the repo root and matches
   `tsconfig.json`'s `**/*.ts` include glob. Excluded it there; included only
   in `tsconfig.worker.json`. See ARCHITECTURE §6 gotcha 7.
2. **`settings`'s Dexie primary key made "backfill ownerId to the real user"
   almost a foot-gun.** `useSettings()`/`mutateSettings()` are hardcoded to
   `LOCAL_OWNER_ID` throughout the app, and Dexie cannot repoint a primary
   key with `update()` anyway. Re-keying it would have silently orphaned
   every settings read post-sign-in. Left it alone on purpose — see
   ARCHITECTURE §2.12.
3. **A one-time backfill isn't enough on its own.** `createTodo`/`createList`/
   etc. all hardcoded `ownerId: LOCAL_OWNER_ID` internally, so without also
   changing what NEW writes use, every post-adoption write would have
   silently re-orphaned itself back onto the placeholder. `getCurrentOwnerId()`
   (`owner.ts`) closes that loop.

## Review — P3 core

Unattended overnight session, run against the plan at
`~/.claude/plans/please-check-this-image-starry-eich.md` (P3 Sync Core — HLC +
field-level LWW). All 5 phases landed, including both stretch phases —
5 commits, one per phase, each individually green (typecheck × 2, lint, full
vitest suite, both build targets). Final state: **271 tests passing** (239
baseline + 32 new), same 1 pre-existing lint error at `use-day-track.ts:156`
as the documented baseline, nothing else touched.

### What landed

- **Phase 1** — `src/lib/sync/hlc.ts` (now split into `hlc-core.ts` + `hlc.ts`,
  see below): `encodeHlc`/`decodeHlc`/`localEvent`/`receiveEvent`/`compareHlc`/
  `getNodeId`. 14 tests, including the backwards-clock-jump case the plan
  called "the single most important test in the file."
- **Phase 2** — `src/lib/sync/merge.ts`: `mergeRecord(local, pending, remote)`.
  11 tests including the two-devices-different-fields acceptance test.
- **Phase 3** — `mutate.ts`'s `nextHlc()` now calls `localEvent()` and persists
  the last-issued HLC in `localStorage`, instead of returning a wall-clock ISO
  string. No schema change; pre-existing outbox rows keep their ISO stamps
  (they sort before any real HLC, and nothing has ever drained the outbox).
- **Phase 4 (stretch)** — `user-do.ts` bootstraps its SQLite storage via
  `drizzle(ctx.storage)`: entity tables mirroring `schema.ts`, `field_clocks`
  (the DO's per-field HLC — D2's server-side counterpart), and `sync_meta`
  (a monotonic version counter for future `since=version` pulls, EI-46).
  Schema/migration only, per D4 — `fetch()` is still the P0 stub, no RPC, no
  client calls. Also added `src/server/sync/apply-patch.ts`, the DO's pure
  per-field merge decision (mirrors `mergeRecord`, 7 tests).
- **Phase 5 (stretch)** — EI-56's tail: priority and location chips on
  `todo-card.tsx`; dropped the "Markdown supported" placeholder instead of
  adding a markdown dependency.

### What didn't land (by design)

Everything D4/the non-goals list ruled out: no outbox drain, no `since=version`
pull loop, no DO fetch routes, no RPC, no `@cloudflare/vitest-pool-workers`,
nothing touching auth, recurrence, sub-tasks, or projects view. Phase 4's DO
code is genuinely untested against a live Durable Object — see below.

### Please review: D2

Per the plan's explicit ask — **field clocks are derived from the outbox, not
stored per-row.** A field's local clock is the newest pending outbox entry
whose patch touches that field; a field with no pending entry is fully synced
and any remote change to it wins unconditionally. This means `mergeRecord`
takes `pending: OutboxEntry[]` and walks it per field on every merge, rather
than reading a stored clock column. Cheap at today's outbox sizes; worth a
second look before P3's real transport starts building on top of it, per the
plan's own flag.

### Surprises worth keeping

1. **A server file importing a client "pure" module can still break the
   Workers typecheck, even for the specific export it needs.** `apply-patch.ts`
   only needed `compareHlc`, but `tsc -p tsconfig.worker.json` type-checks the
   *whole* imported file under the importing project's `lib` config — and
   `hlc.ts` had `getNodeId()`'s `localStorage` reference sitting right next to
   the pure math, which broke under the worker's DOM-less `lib`. Fixed by
   splitting `hlc.ts` into `hlc-core.ts` (pure math, safe to import from
   anywhere) and `hlc.ts` (re-exports the core, adds `getNodeId`). Client code
   (`mutate.ts`) needed zero changes — it still imports everything from
   `@/lib/sync/hlc`. **Rule for later:** a module meant to be shared between
   client and Workers code should have zero DOM-only bindings anywhere in the
   file, not just in the parts a given importer happens to use.
2. **`drizzle-kit generate --driver durable-sqlite` emits a `migrations.js`
   that assumes a bundler `.sql`-as-text import rule** (`import m0000 from
   './0000_x.sql'`) for use with `drizzle-orm/durable-sqlite`'s `migrate()`.
   wrangler.jsonc has no such rule configured, and adding one sight-unseen in
   an unattended session felt like exactly the kind of "chase DO integration
   at 3am" the plan warned against. Went with hand-written `CREATE TABLE IF
   NOT EXISTS` DDL executed directly via `ctx.storage.sql.exec()` in the
   constructor instead — same effect, no new bundler config, and it's what the
   generated SQL file is now a diff target for (see `bootstrap.ts`'s header).
   Deleted the unused generated `migrations.js` (it also failed lint as
   generated boilerplate).
3. **`wrangler deploy --dry-run` is a good, free verification step for Workers
   code that `tsc`/`next build` can't reach.** Neither `npm run build` nor
   `build:static` actually bundles `worker.ts` through wrangler's esbuild —
   they're pure Next builds. A dry-run (no publish, no live infra touched)
   confirmed `drizzle-orm/durable-sqlite` and the new schema imports actually
   resolve in the real Workers bundler, not just under `tsc`. Worth adding to
   the standard verification list for any future `src/server` change, not
   just this one.
4. **Don't spawn `npm run dev` blind in a long-running session without
   checking for an existing one first** — `npm run dev` (via the OpenNext dev
   integration) reported a conflicting dev server already on a different port
   before I'd checked. Turned out to be my own earlier spawn, not something
   Rob had running, but I couldn't tell that from the error message alone, so
   I killed my own process and skipped the live smoke test rather than risk
   it. Relied on typecheck/build/dry-run instead for Phase 5's UI change.
   **Rule:** `lsof`/`ps` for an existing process on the target port *before*
   backgrounding a dev server, especially unattended.
5. **The "legacy outbox rows sort before any real HLC" claim two paragraphs
   above (D2's summary), and the same claim in `mutate.ts`'s original comment
   and in `docs/SYNC.md`, was backwards — they sort AFTER.** `"2026-…"[0]` is
   `'2'`, a real HLC's leading hex digit is `'0'` at any epoch before the year
   10889, and `compareHlc` is plain string comparison — so a legacy entry wins
   every LWW comparison it is ever compared in, forever. Found when P3's
   transport work began: `adopt-owner.ts:42` was still writing `hlc: now()` on
   every first sign-in, so this was live, not only historical. Fixed at the
   source (`adopt-owner.ts` now uses `mutate.ts`'s real `enqueue`) and by a
   one-time `normalizeOutboxHlcs()` migration
   (`src/lib/store/normalize-outbox.ts`) gated on a localStorage flag, plus a
   regression test pinning the sort direction (`hlc.test.ts`) so the comment
   can't drift back to wrong. See `docs/SYNC.md`'s "Known traps".

### Also still outstanding (unrelated to this session, from P2)

Unchanged from the plan — DNS, OAuth app registration, and secrets, in that
order (see the P2 section above for the full list and reasoning).

## Review — P3 transport (EI-46 + EI-48)

Five phases, one commit each, all green (typecheck × 2, full vitest suite,
both build targets, `wrangler deploy --dry-run`). Final state: **359 tests
passing** (271 baseline + 88 new), same 1 pre-existing lint error as the
documented baseline. Scope was P3 only, per Rob's call — EI-49 (WebSocket
push, P4) stays a separate follow-up.

### What landed

- **Phase 0** — the HLC-direction bug (see Surprise #5 above) fixed at the
  source plus a one-time migration.
- **Phase 1** — `src/lib/sync/wire.ts` (the push/pull wire types and
  `changesFromRow`, which groups a row's fields into one `WireChange` per
  distinct HLC — never the row's max HLC, which would silently let a stale
  field clobber a newer local edit on a different field) and
  `src/server/sync/columns.ts`/`upsert.ts` (patch whitelist + JS↔SQL
  coercion derived from the drizzle schema itself, and NOT-NULL synthesis
  for a partial create).
- **Phase 2 (EI-46)** — `UserDurableObject.push()`/`pull()` RPC behind a new
  `/api/sync/*` branch in `worker.ts`. RPC rather than `fetch()` routing, so
  `fetch()` stays a clean stub for P4's WebSocket upgrade. One version is
  allocated per row actually written (not per push batch, and not at all
  when a push changes nothing), so a scalar cursor can page correctly and a
  duplicate push can't churn every device into a needless re-pull.
- **Phase 3 (EI-48, client half)** — `src/lib/sync/{hydrate,apply-plan,drain}.ts`
  decide what a pull page writes locally and what a push batch sends,
  without ever touching the outbox from the apply side (that would echo
  every remote change straight back into the next push, forever).
- **Phase 4 (EI-48, transport)** — `engine.ts`'s poll loop, mounted via
  `SyncProvider` next to `SessionProvider`. Gates on
  `getBoundOwnerId() === session.user.id`, not on the session existing —
  see Surprise below. `UserDurableObject.wipe()` closes the orphaned-DO trap
  from the P2/P3 handoff doc via Better Auth's `user.deleteUser.afterDelete`.

### Please review: settings excluded from sync — ✅ resolved (EI-60)

Rob's call this session: `kind === "settings"` outbox entries are dropped
from the drain and deleted locally rather than synced. `board.tsx`'s tab
switcher writes one every time the active tab changes, so keeping
unackable entries around would grow the outbox without bound and slow
`findLocalFieldHlc` on every future merge. Cost: `schema.ts`'s comment
promising `fontPairing`/`theme` sync across devices doesn't hold yet, and
settings changes made before an eventual settings-sync phase land are
silently lost (never pushed, so never recoverable). Worth a second look
before that promise ships elsewhere in the UI.

**Resolved the same session** — see "Review — EI-60" below. `activeTabId`
specifically stays excluded, permanently, by design.

### Surprises worth keeping

1. **`Object.hasOwn` alone doesn't need a `__proto__` special case, but the
   input side does.** `sanitizePatch`'s whitelist check
   (`Object.hasOwn(columns, key)`) is safe by construction either way — but
   worth knowing why: `JSON.parse('{"__proto__":1}')` creates a normal own
   property (JSON.parse doesn't trigger the setter the way object-literal or
   bracket-assignment syntax does), so a patch parsed from a request body
   really can carry `Object.keys(patch)` containing `"__proto__"`. Pinned by
   a test (`columns.test.ts`) rather than left to be re-discovered under
   incident conditions.
2. **The engine's activation gate had to be "adopted into this session's
   user", not "has a session" — session alone is briefly true against the
   WRONG board.** `SessionProvider` shows a "switch accounts?" confirmation
   dialog *before* calling `resetLocalDataForNewOwner()` when a different
   account signs in on a bound device. In that window, `useSession()` already
   returns the new account, but the local board is still the old account's.
   Gating the sync engine on the session alone would have pushed the old
   account's entire board into the new account's Durable Object while that
   dialog was still on screen. Caught during design, before any code was
   written — worth flagging as the kind of bug that's invisible in every
   test that doesn't specifically construct the account-switch race.
3. **A live smoke test against a real Durable Object found nothing round-trip.test.ts's
   fake-store composition could have missed, which is itself the useful
   signal.** Ran a temporary `wrangler dev` instance on an unused port
   (8790) specifically so as not to disturb an already-running preview
   instance on 8787 — `ps`-checked first, per the existing dev-server lesson
   above, and killed only the PID this session spawned. Exercised: an
   unauthenticated 401, a real INSERT with NOT-NULL synthesis (confirmed the
   synthesized fields come back grouped under `FLOOR_HLC`, exactly as
   designed), a real UPDATE with correct version increment, JSON coercion
   for `labelIds` round-tripping through SQLite TEXT, and a byte-identical
   duplicate push correctly re-acking with zero version churn and reporting
   every field as a self-conflict (ties lose, as designed). All matched the
   pure-function tests' predictions exactly — evidence the pure/impure split
   is doing its job, not just evidence the DO works. One thing this could
   NOT reach locally: the `user.deleteUser` endpoint's CSRF Origin check
   rejects any port not in `TRUSTED_ORIGINS`, so `wipe()`'s actual
   invocation via the Better Auth hook is unverified end-to-end — the
   `ctx.storage.deleteAll()` call itself is a single, stable, documented
   platform API, so this is a low-risk gap, but it's a real one. Verify it
   once against `myfaite.app` (or a branch preview) with a disposable test
   account before relying on it in production.
4. **Local email verification blocked sign-in even on `localhost`, for a
   reason unrelated to any change this session.** `curl`-driven sign-up
   left `email_verified = 0` and sign-in 403'd with `EMAIL_NOT_VERIFIED` —
   reproduced identically against the untouched pre-existing dev process, so
   confirmed pre-existing rather than a regression from this session's
   `auth.ts` edit (the `user.deleteUser` block, which doesn't touch
   `requireEmailVerification`/`isLocal`). Worked around via the exact
   `UPDATE user SET email_verified = 1` command `docs/SETUP.md` already
   documents for this class of problem. Root cause not investigated — likely
   `request.url`'s origin under `wrangler dev`'s local socket proxying not
   resolving to a bare `localhost`/`127.0.0.1` hostname — but that's a P2
   auth question, out of scope here.

## Review — EI-60 (settings sync)

Same-session follow-up once Rob asked for it. All green (typecheck × 2, full
vitest suite — 376 tests, 17 new — both build targets, `wrangler
deploy --dry-run`).

### What landed

Widened `SyncKind` to include `"settings"` and reused every piece of P3's
transport unchanged (wire format, merge, push/pull loop, poll engine).
Settings' one real difference from the other five kinds — a singleton with
no `id` column, keyed by `ownerId` itself — needed small, localized branches
rather than a parallel system:

- `SETTINGS_ENTITY_ID` (`wire.ts`): a shared sentinel entityId for "the one
  settings row". The server overrides whatever the client sends to this
  constant on push and emits it on pull, so neither side needs to agree on
  the other's actual identity convention.
- `SETTINGS_SYNCED_FIELDS` (`wire.ts`): the sync allow-list, excluding
  `activeTabId` permanently (device view-state, highest-frequency writer).
- Server: `user-do.ts`'s `rowExists`/`updateRow` branch on `owner_id`
  instead of `id` for settings; `upsert.ts`'s `buildInsertColumns` now
  filters its output to only columns the kind actually has (a generic fix,
  not settings-specific — protects every kind against a future stray key,
  not just this one).
- Client: `apply-plan.ts` forces `ownerId = LOCAL_OWNER_ID` when hydrating a
  new local settings row (never the signed-in user's real id — settings is
  permanently excluded from `adoptLocalData`, ARCHITECTURE §2.12);
  `apply-remote.ts` substitutes `LOCAL_OWNER_ID` for the wire's `entityId`
  on every Dexie read/write.

### A live smoke test caught a real bug the unit tests didn't

`activeTabId` — a real, always-present SQLite column, simply never written
server-side — rode along as `null` in every pull's `FLOOR_HLC` group,
because `changesFromRow` only knew about `SERVER_ONLY_FIELDS`, not the
settings allow-list. `sanitizePatch` blocked it on the way *in*; nothing
blocked it on the way *out*. Once a device's local pending edit for
`activeTabId` cleared (which the drain does immediately, since an
`activeTabId`-only entry never has anything left to push), that server-side
`null` would win the merge outright on the next pull and silently reset
which tab was showing — on every device, forever.

The hand-written unit tests for `changesFromRow`/`mergePages` never caught
this because I controlled the row fixtures directly and never happened to
include `activeTabId` in one. `round-trip.test.ts`'s in-memory fake didn't
either, and structurally *can't* without more work — it only ever stores
fields that were explicitly patched, unlike a real `SELECT *` which returns
every column a `CREATE TABLE` declared, defaulting the untouched ones to
`NULL`. That gap between "a fake that stores what you tell it to" and "a
database that returns everything it has" is exactly the class of bug a live
smoke test exists to catch. Fixed in `changesFromRow` itself (enforces the
allow-list on output too, not just `sanitizePatch` on input) and pinned with
a regression test. Left `round-trip.test.ts`'s fake as-is rather than
rebuilding it to model full-row fidelity — the direct `wire.test.ts` test is
the right place for this specific case, and widening the fake's fidelity
for one bug felt like solving a problem I hadn't actually hit elsewhere yet.

### Verified live, against a real Durable Object

Same pattern as the P3 transport session: temporary `wrangler dev` on an
unused port, `ps`-checked first, never touching an already-running preview
instance, test account cleaned up after. Confirmed: a first-ever settings
push correctly synthesizes `fontPairing`/`theme`/`avatarKind` (no SQL
default) with no `field_clocks` row, grouping them under `FLOOR_HLC` on
pull exactly like any other kind's partial create; a second push updates
via the `owner_id`-keyed branch with the version correctly incrementing;
`workdays` round-trips as a real JS array through SQLite TEXT storage; and
— after the fix — `activeTabId` never appears in any pull response,
confirmed by re-querying the same live instance without restarting it
(`wrangler dev` picked up the `src/lib`/`src/server` source fix live,
since only `.open-next/worker.js` itself requires a full rebuild).

## Review — data-loss incident (post-EI-60, same day)

Rob two-browser-tested the finished P3 transport himself: created a todo in
one browser, watched it sync to the other — then, ~30 seconds after signing
in on the second browser, every list and the renamed "Personal Lists" tab
were replaced by a single tab and list both named "Untitled". Five commits,
each independently verified (typecheck × 2, full vitest suite, both build
targets, `wrangler deploy --dry-run` for any `src/server` change), the first
four in direct response to the report, the fifth this doc.

### The chain, and why it's a regression from this session, not a pre-existing flaw

`git log -S FLOOR_HLC` puts the sentinel's first appearance in `a9ba28f`
(this session's Phase 1). `merge.ts` hadn't been touched since the original
EI-47 work. The bug is the interaction between a sentinel added this
session and a short-circuit that already existed in `merge.ts` — fixing it
there is not a redesign of the pinned EI-47 semantics, it's making
`FLOOR_HLC` behave the way its own docstring already claimed.

1. `seedIfEmpty()`/`ensureDefaultTab()` wrote seed rows with raw Dexie
   `put()`, bypassing `mutate()`/`create()` — no outbox entry, ever.
2. Sign-in → `adoptLocalData()` enqueues `{ownerId, updatedAt}` →
   `sanitizePatch` strips `ownerId` (server-only) → the server receives
   `{updatedAt}` for a row it's never seen.
3. `buildInsertColumns` synthesizes `name: "Untitled"`, `tabId: null`,
   `isBacklog: false` — with no `field_clocks` row for any of them.
4. Pull emits those under `FLOOR_HLC`. `merge.ts`'s `remoteWins =
   localHlc === null || compareHlc(...) > 0` short-circuits on
   `localHlc === null` *before comparing clocks at all* — a placeholder
   designed to always lose won outright.
5. Next boot, `repairDuplicateLists()` grouped the now-identically-"Untitled"
   lists **by name only** and hard-deleted all but one, no tombstone, no
   outbox entry — the step that actually matches the screenshot (one tab,
   one list).

### What landed, in commit order

1. **`33531f8`** — `merge.ts`'s per-field guard: a `FLOOR_HLC` field may
   populate a value the local row doesn't have, never overwrite one it does.
   Keyed on `local[field] !== undefined` specifically — `Object.hasOwn`
   would wrongly block the pre-tabs `tabId: undefined` populate case, and
   `local !== undefined` alone would wrongly let a `FLOOR_HLC` `null`
   clobber a real `tabId`. Confirmed a genuine regression test by reverting
   `merge.ts` and re-running before trusting it.
2. **`a14c301`** — root cause: `seedWrite()` (`mutate.ts`) gives every seed
   row a real outbox entry at a new `SEED_HLC` sentinel — strictly above
   `FLOOR_HLC`, strictly below every real HLC. Populates a genuinely fresh
   account; loses every field to any real edit on an established one, so a
   second browser's fresh seed can never again overwrite a renamed board.
   `hydrateRemoteRow` also stops synthesizing `name`/`title` when genuinely
   missing (fails closed instead) — belt-and-suspenders, since this path is
   provably unreachable in normal operation once seeds push complete rows.
3. **`012b780`** — `repairDuplicateLists` deleted outright, not gated. Its
   own comment already said "safe to remove once no local database predates
   the fix"; its own tests asserted the destruction it caused as intended.
4. **`1545aa3`** — two adjacent hardening fixes found while diagnosing:
   `planDrain` had no cap but `routes.ts` enforced one, so an outbox over
   500 entries 400'd on every push, and push ran before pull with no
   isolation, so the pull never ran either — sync silently dead in both
   directions. `runSyncCycle` now chunks at `MAX_PUSH_ENTRIES` (moved into
   `wire.ts` so client/server share one constant) and isolates a push
   failure from the pull loop, except `SyncAuthError`, which still
   short-circuits both. Also added the `console.error`/`console.warn` calls
   that would have surfaced this incident in the console instead of only in
   a screenshot a week later.
5. **This commit** — `docs/SYNC.md`'s "Known traps" (the `FLOOR_HLC`
   contract, `SEED_HLC`, the DO-reset-strands-every-cursor trap),
   `ARCHITECTURE.md` §2.5/§2.8, and a `.ai/lessons.md` entry.

### Decisions Rob made, verbatim reasoning

- **Fix Phase 1 alone first, then re-test** — approved, then explicitly
  waived once Phases 2-3 were also queued ("keep me abreast... continue
  executing"), so all four landed in sequence without a pause between them.
- **Delete `repairDuplicateLists` outright**, not gate it to pre-sync —
  taken as given from the plan's recommendation.
- **Don't recover the pre-fix data.** "It was all boilerplate test data
  anyway... I just want to make sure that my new data... does not get
  deleted or overwritten." This is why there's no `backfillSeedCreates()`
  migration, no reset route, no DO wipe in this set of commits — recovery
  was explicitly out of scope, which simplified Phase 2 considerably (no
  need to repair rows that already exist server-side with no outbox
  provenance).

### Surprises worth keeping

1. **A live two-browser test found a bug 393 passing tests didn't**, and
   found it inside the same session the code shipped in. `merge.test.ts` had
   eleven tests before this and zero of them constructed "local already has
   a real value, no pending entry, remote is the sentinel" — every one of
   them predated `FLOOR_HLC`. The `.ai/lessons.md` entry generalizes this:
   a sentinel's ordering guarantee is a claim about what a *comparison
   function* does with it, not about the value in isolation, and a
   short-circuit can route around the comparison for exactly the input the
   guarantee depends on.
2. **The `SEED_HLC` design ties two of this session's earlier decisions
   together in a way that only became visible once they collided.**
   `DEFAULT_TAB_ID`/`seed:list:*` being deterministic constants (§2.10,
   built for cross-device convergence) is what made the incident
   *reproducible* on a second browser rather than a one-off — and it's also
   exactly what makes `SEED_HLC` safe: two devices' fresh seeds carrying the
   identical clock for the identical id is a feature (a guaranteed tie that
   loses to any real edit), not a coincidence to work around.
3. **`resolveEntityPush`'s per-hlc-group folding, built for EI-46, is what
   let the `round-trip.test.ts` regression for this incident be a real
   end-to-end test rather than a unit test in isolation.** Composing
   `validateEntries` → `groupByEntity` → `resolveEntityPush` →
   `buildInsertColumns` → `mergePages` against a fake store and then folding
   the result through the real `mergeRecord` is what caught that my first
   draft of the settings round-trip regression test (in the EI-60 session)
   had the wrong expectation — and the same composition is what proved
   `SEED_HLC` correct in both directions before it ever touched a real
   Durable Object.

## Review — P4 (EI-49, WebSocket live push)

Six commits on `rob/ei-49-websocket-live-push-with-hibernation`, each
independently verified. **504 tests passing** (376 baseline + 128 new), both
build targets green, `wrangler deploy --dry-run` green on every commit that
touched `src/server`, same single pre-existing lint error.

### What landed

- **Phase 0 (`528e33f`)** — two latent defects P4 would have inherited.
  `readFieldClocksBulk` built one `IN (?, …)` over the union of six kinds'
  pages: up to 600 bound parameters against SQLite's documented ceiling of
  **100**. Latent only because the account is small, and it would have fired
  first on a `since=0` or long-offline catch-up — the exact pull reconnect
  depends on. And `wipe()` called `deleteAll()` and stopped, leaving the
  object alive with no schema, since the constructor's bootstrap has already
  run and won't re-run until a cold start. Latent pre-P4 because the D1 user
  row was gone and nothing could get back in; **a live socket is precisely
  what removes that protection.**
- **Phase 1 (`12c5ba3`)** — `ws-protocol.ts` (envelope, DOM-free, no zod),
  `validate.ts` (`parsePushRequest`/`clampPullArgs` lifted out of
  `routes.ts`), `backoff.ts`. No behaviour change.
- **Phase 2 (`42a2998`)** — `/api/sync/ws` + the DO's `fetch()` upgrade and
  three hibernation handlers. Driven end-to-end by a node harness before any
  client code existed.
- **Phase 3 (`80e8562`)** — `ws-transport.ts`, `pending-requests.ts`,
  `fallback-transport.ts`, `notifyRemoteChange()`, provider wiring.
- **Phase 4 (`3cee615`)** — broadcast on write. The actual point.
- **Phase 5** — adaptive interval, docs, `scripts/sync-smoke/`.

### Surprises worth keeping

1. **A WebSocket handshake bypasses CORS entirely.** It is sent with cookies
   and no preflight; `Access-Control-Allow-Origin` doesn't gate whether the
   connection is established. On `/api/sync/push` the origin check is
   effectively decoration because CORS already stops a cross-site `fetch`
   from reading the response; on `/api/sync/ws` the identical-looking code is
   the *only* thing between evil.com and a signed-in board. Nothing in the
   repo did this job already, precisely because every prior sync request went
   through `fetch`. **And the obvious implementation is wrong**: rejecting
   anything off `TRUSTED_ORIGINS` would silently 403 every branch preview
   (`*-faite.bfmw-dev.workers.dev` is deliberately absent from that list)
   while HTTP sync kept working — which presents as "hibernation is broken".
   It has to be same-origin **OR** the allow-list.
2. **`docs/SYNC.md`'s pre-written plan was right about the shape and wrong
   in five specifics**, each caught by an adversarial review before any code
   was written. Notably: it said to extract shared `push`/`pull` bodies (the
   wrong layer — they're ordinary methods, so the WS handler just calls them;
   what actually needed sharing was `routes.ts`'s *validation*, without which
   the socket path hands `pull()` an unclamped `LIMIT` across six kinds), and
   to wire `onRemoteChange` to `runner.runSync()` (which bypasses both the
   `isActive()` gate and the `faite:sync` Web Lock — `trigger()` keeps both
   and drops only the debounce, which is the part that should be dropped).
3. **A fast two-tab test cannot see hibernation.** Idle eviction is a
   **70–140s window**, so "edit here, watch it appear there" proves the
   broadcast path and nothing about whether `deserializeAttachment` restores
   `userId` after the constructor re-runs. `hibernate.mjs` idles 170s and
   then pushes, because `owner_id` on that insert can only have come from the
   attachment. It passed — but nothing else in the repo could have told us.
4. **A throw out of `webSocketMessage` is not a local failure.** It can break
   the stub for *every* socket on the object, so one tab's malformed frame
   could disconnect a different device. The assertion that matters in
   `smoke.mjs` is therefore not "the socket survived" but "a *second,
   concurrent* socket survived".
5. **A request timeout has to close the socket, not just fail the call.** A
   zombie socket keeps `readyState === OPEN` long after a laptop sleeps.
   Treating a timeout as one failed call leaves every later push and pull
   paying the full timeout inside `runSyncCycle`'s `while (hasMore)` loop.
6. **`setInterval` cannot re-read its own delay.** Relaxing the poll interval
   when a socket connects required converting to a self-rescheduling
   `setTimeout` — which incidentally fixed a pre-existing quirk where a tab
   that drew a low jitter value kept that same offset for its whole lifetime.

### Verified live, against a real Durable Object

Isolated `wrangler dev` on port **8790** (`lsof`-checked first; both 8787 and
8790 were free, so nothing of Rob's was disturbed; only the spawned PID was
killed). Harnesses kept at `scripts/sync-smoke/`.

- `smoke.mjs` — **18/18.** Handshake guards (401 unauthenticated, 403 hostile
  origin, 426 non-upgrade, absent origin allowed), push/pull round trips
  matching the HTTP shapes, shared validation (bad protocol, negative cursor,
  clamped absurd limit, 501-entry batch rejected), and a barrage of malformed
  and binary frames leaving both sockets serving.
- `broadcast.mjs` — **12/12.** Write on A reaches B and C but not A; the frame
  carries the causing version; a no-op push broadcasts nothing; an HTTP push
  notifies all three; and after abruptly terminating one socket, a further
  push still acks and still reaches the survivor.
- `hibernate.mjs` — **passed.** 170s idle, then push and pull on the same
  socket, with the pre-hibernation row still present.

### What it could NOT reach

- **Two real browsers.** The harnesses prove the protocol, not the board —
  no Dexie, no `mergeRecord`, no React. That is Rob's test.
- **`wipe()` end-to-end**, still. Same blocker as P3: the `/delete-user`
  endpoint's CSRF Origin check rejects a non-`TRUSTED_ORIGINS` port. The
  Phase 0 change to it (close sockets → delete → re-bootstrap) is therefore
  reasoned, reviewed, and unexercised.
- **Capacitor.** The `WebSocket` constructor has no `credentials` option, so
  cookies follow SameSite with no override and `capacitor://localhost` →
  `myfaite.app` is cross-site. Very likely stays on the HTTP fallback; not
  verified, and a P7 question.

### Open follow-ups

- [ ] Two-machine confirmation (Rob).
- [ ] Verify `wipe()` once against `myfaite.app` or a branch preview with a
  disposable account — carried over from P3, now with more to check.
- [ ] Decide whether `MAX_SOCKET_AGE_MS` (1h) is the right ceiling once
  there's real usage data. It bounds, but does not eliminate, the window in
  which a socket outlives the session that authorised it.
