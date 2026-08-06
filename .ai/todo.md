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

## P4 — Sync v1
- [ ] WebSocket push, hibernation, reconnect/backfill, multi-tab

## P5 — API + docs
- [ ] Zod → OpenAPI, tokens, rate limits

## P6 — Fast follow
- [ ] Projects + views · sub-tasks · recurrence (RRULE + exceptions)
- [x] Priority 1–4 — editable since P1/P2, now also visible on the card (chip,
      pulled forward as EI-56's tail)
- [x] List tabs (pulled forward — grouping, colour, drag-sort, cross-tab carry)
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
