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

> **The phase blocks below are the plan. The `Review —` sections further down
> are the live record of what actually shipped.** When the two disagree, the
> Review sections and `docs/` win. Last reconciled against Linear and `main`
> on 2026-08-12.

## P5 — API + docs
**Status: not started.** The only untouched phase, and now the largest single
piece of remaining work.
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
- [x] Priority 1–4 — editable since P1/P2, now also visible on the card (chip,
      pulled forward as EI-56's tail)
- [x] List tabs (pulled forward — grouping, color, drag-sort, cross-tab carry)
- [x] Location — editable since P1/P2, now also visible on the card (chip)
- [x] Markdown descriptions (EI-56) — the earlier "punted on purpose" call was
      reversed: `components/ui/markdown-field.tsx` wraps BlockNote and backs
      both `todo.description` and `dayNote.body`. Markdown stays the *stored*
      format.
- [x] Recurrence (EI-54) — **not RRULE.** A versioned JSON rule blob in
      `Todo.recurrenceRule`, `anchor` inside the blob, occurrences materialized
      on touch, no exceptions table. See `lib/recurrence.ts`.
- [x] Saved places (EI-63) — shipped additively as the `place` kind;
      `Todo.location` free text is UNCHANGED, `placeId` sits alongside it, so
      the `location`→`locationId` LWW fork never has to happen. Google
      typeahead split out to EI-83.
- [x] Day notes + derived activity timeline (EI-87) — `dayNote`, the 7th sync
      kind, deterministic id `daynote:YYYY-MM-DD`.
- [x] Foreground reminders (EI-88) · resizable board split (EI-89) · board view
      settings (EI-90) · ⌘K overhaul (EI-92)
- [ ] Sub-tasks (EI-55) — `Todo.parentId` is reserved in the schema; no UI, no
      logic. Deliberately not started.
- [ ] Saved views (EI-65) — distinct from the view-settings dropdown that
      shipped as EI-90.
- [ ] Icon upload · magic-link auth (EI-66; Google moved into P2)
- [ ] Palette command registry (EI-77) · shortcut help sheet (EI-75) · dnd-kit
      screen-reader announcements (EI-84)

## Mobile & responsive — M-1…M6 (separate axis, see `docs/MOBILE.md`)
Numbered M, not P, on purpose: these do NOT line up with the roadmap phases
above. M3 is the phone shell; P3 was sync v0.
- [x] M-1 Playwright E2E harness (EI-85) — 5 device projects, real touch via
      CDP, runs in CI
- [x] M0 foundations · M1 touch remediation · M2 `board.tsx` extraction ·
      M3 phone shell (EI-86)
- [ ] M4 adaptive overlays · M5 `@floating-ui` mention menu + BlockNote-on-touch
      audit · M6 optional swipe-up drawer — paused deliberately

## P7 — Capacitor + MCP
Not started, but substantially pre-paid: the static-export app-shell entry,
safe-area vars, `useViewport()`, and the E2E harness all landed with the mobile
work.

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

---

## Card redesign — priority rail, wrapping title, inline location pin

Feedback on `/board`: titles ran on one line and overflowed into neighbouring
columns, the grip and the priority/location chips ate the width of a 168px
column.

- [x] `src/lib/priority.ts` + tests — `PRIORITY_RAILS`, 3/2/1/1px ·
      `#e5484d` `#f76b15` `#3e63dd` `#00a2c7`. Two channels arranged so no two
      levels share both width and colour; that invariant is a test.
- [x] Sensors split: `MouseSensor {distance:4}` + `TouchSensor {delay:250,
      tolerance:8}` + `KeyboardSensor`. Touch now lifts from anywhere on a row,
      so nothing depends on `touch-action: none` any more.
- [x] `todo-card.tsx`: priority rail (absolute span, not `border-l`), title
      `line-clamp-3` with `min-w-0` + `wrap-break-word`, inline `MapPin` with a
      hover tooltip and `sr-only` text, grip absolutely positioned in a 12px
      gutter and revealed on hover/focus, priority + location chips removed.
- [x] Drag overlay chip mirrors the rail and the pin.
- [x] `todo-card.test.tsx` — 15 assertions, including the two invariants that
      fail silently (grip hit area cannot overlap the checkbox; the tooltip
      trigger stays a non-interactive `span` inside the title button).
- [x] `docs/DRAG-AND-DROP.md` §3/§4.8/§4.9/§4.10/§4.11/§5.4/§5.5/§6/§7/§8 and
      `docs/KEYBOARD.md` §1.

### Review

The reported bug was not `truncate`. The title button was `flex-1` with no
`min-w-0`, so its automatic minimum size was the title's min-content width and
the flex item refused to shrink — `truncate` only hid the overflow. `min-w-0` is
the fix; the clamp is the design change.

The sensor split had a trap: `useSortable`'s `listeners` map is keyed by whatever
activators the bound sensors provide, so dropping `PointerSensor` renamed
`onPointerDown` to `onMouseDown`/`onTouchStart`. Both `todo-card.tsx` and
`board-column.tsx` cast that map, so nothing type-errored — the row and the
column header would simply have stopped dragging. Now documented as a warning in
§4.11.

### Open

- [ ] Suite not run in-session (the sandbox would not approve `npm test`).
      Needs `npm run verify`.
- [ ] Test-count figures in `docs/DRAG-AND-DROP.md` §8, `docs/ARCHITECTURE.md`
      §8 and `docs/SETUP.md` still say 559 — update once the new count is known.
- [ ] Manual checks 16–20 in `docs/DRAG-AND-DROP.md` §8, especially the pin's
      baseline inside a `-webkit-box` in Safari, and P4's 1px cyan rail in light
      theme.
- [ ] Clamp depth as a local-only setting (`TITLE_CLAMP` is the seam).

### Round 2 — sheet textarea, wrap under checkbox, overflow tooltip, deadlines

- [x] `src/lib/title.ts` — `TITLE_LINES` / `TITLE_CLAMP_CLASS`, shared by the card
      clamp and the sheet's title field so the two cannot drift.
- [x] `todo-sheet.tsx` title is a `Textarea` (`field-sizing-content`, `rows={1}`,
      max-height = `TITLE_LINES` lines). Enter still commits.
- [x] Card row is no longer a flex container: the checkbox joins the grip as an
      absolute in the left gutter, the title button is `block w-full`, and
      `indent-6` clears the checkbox on line 1 only — so lines 2 and 3 run under
      it. Works inside `line-clamp`'s `-webkit-box` because text-indent is
      inherited by the anonymous block (CSS 2.1 §9.2.1.1).
- [x] Full-title tooltip, gated on a `ResizeObserver` measurement rather than a
      hover measurement (the hover version only opens on the *second* hover,
      because the measurement is what enables the trigger).
- [x] `formatDeadlineDue()` in `lib/scheduling.ts` + tests; inline `CalendarCheck`
      marker for an upcoming deadline. A missed deadline keeps the destructive
      badge and gets no marker — one fact, one indicator.
- [x] `deadlineCounts` in `board.tsx` → `dueCount` on day columns → destructive
      "N due" banner under the header. Counted across every open todo, since a
      deadline is independent of placement.
- [x] Checkbox `after:-inset-x-1`: the shadcn base's 12px expansion reached back
      over the whole grip from `left-3`, so a click on the grip toggled done.
- [x] Docs: DRAG-AND-DROP §6 card + column visual states, checklist 16 and 21–25.

### Open

- [ ] Still unrun in-session — the sandbox declines `npm test` / `npm run
      typecheck`. Needs `npm run verify`.
- [ ] No test for the due banner (needs a `board-column.test.tsx`); it is on the
      manual checklist as item 24 instead.
- [ ] Bootstrap's `calendar2-check` was substituted with lucide's `CalendarCheck`
      rather than adding a second icon set for one glyph.

---

## Day columns group by originating list

Cards scheduled onto a day lost all trace of where they came from. Day columns and
Overflow are now a computed view: grouped by list, alphabetical on the list name
with a leading "To " stripped, priority-ordered inside each group, collapsible.
The planning half is unchanged — the thesis is "planning half by hand, calendar
half computed".

- [x] Per-list colours. `List.color` existed end to end (schema, DO table, sync)
      with no writer; added `ColorPicker` to `list-info-dialog.tsx`,
      `renameListWithUndo` → `updateListWithUndo(list, patch, label)`. A list's
      colour now wins over its tab's accent on its own column header.
- [x] `lib/colors.ts` `wash()` (~10%). `lib/priority.ts` `priorityRank` +
      `byPriorityThenPosition`.
- [x] `lib/board.ts`: `TodoGroup`, `listSortKey`, `byListGroup` (one hoisted
      `Intl.Collator`, base sensitivity, numeric), `dayGroupId`/`parseDayGroupId`,
      `isDropZoneId` + `preferPreciseTarget` extended to groups, `buildBoard`
      grouping. **`hiddenListIds: Set<string>` → `hiddenLists: List[]`** — records,
      not ids, or every other tab's scheduled cards group under Backlog and a drop
      on that header rewrites their `listId`.
- [x] `board-column.tsx`: `TodoGroupSection` (header + wash + group indicator),
      `NO_SORTING`, `CARDS_NOT_DROPPABLE`, filler rows counting headers.
- [x] `column-nav.ts`: `NavItem`/`cardItems`/`groupStop`; collapsed groups
      contribute a header and no card stops.
- [x] Drop gesture: `dayGroupPatch`/`moveTodoToDayGroup`, the `parseDayGroupId`
      branch in `handleDragEnd`, `overGroupId`, and the day branch no longer
      writing a position.
- [x] Tests: board (sort key, group comparator, grouping, id space, precedence),
      priority (rank + comparator), column-nav (grouped stops), new
      `board-column.test.tsx`, plus the todo-card guard that the wash stays off
      the row.
- [x] Docs: DRAG-AND-DROP §3/§6/§8 + a new §4.13; KEYBOARD §1 and §11.1.

### Review

Three things the dnd-kit source decided, all verified in `node_modules`:
`SortableContext`'s `disabled` reaches each card's `useDroppable`, so one prop
makes day-column cards sources-not-targets; dnd-kit passes only enabled droppables
to collision detection, so the per-card insertion line vanishes from that half for
free; and `verticalListSortingStrategy` at `overIndex: -1` shifts every card above
the dragged one, so a grouped column must pass a no-op strategy.

Caught in self-review: branching the render on `groups` rather than
`groups.length > 0` would have rendered zero cards in `buildBoard`'s degenerate
no-lists fallback.

### Verified

`npm test` → **687/687 passing, 52 files.** Covers all three rounds of work (card
redesign, deadline/sheet round, and this grouping feature).

One real bug found by a new test, and it was worth writing: `tailwind-merge` does
not treat `before:-inset-1.5` as conflicting with `before:-inset-y-1.5` /
`before:inset-x-0`, so `DragGrip`'s base shorthand survived the card's override and
which side won came down to CSS source order — an invisible 24px box over the
checkbox, eating its clicks. Fixed at the source: `drag-grip.tsx` now states the
expansion per axis (`before:-inset-x-1.5 before:-inset-y-1.5`) so a caller can
override one axis, and the test asserts the base is merged away rather than merely
overridden.

### Open

- [ ] `npm run typecheck`, `npm run lint` and both builds have NOT run — only
      `npm test` was approved in the sandbox. `npm run verify` covers all of it.
- [ ] Collapse state is `useState`, so it resets on reload. Persisting it is a
      `settings.collapsedListGroups` field: seven-file schema op plus
      `JSON_ENCODED_FIELDS`, and it needs a `pendingRef` guard because toggling
      writes the whole array.
- [ ] Existing hand-arranged day columns will visibly reshuffle on first load.
      Nothing is destroyed (`position` becomes a tiebreaker) but there is no undo
      for it — worth a release note.
- [ ] Priority sub-headers were deliberately not built. `TodoGroup` carries
      `key`/`name`/`color` rather than a `List`, so a priority grouping mode is
      filling three fields if it is ever wanted.

### CI now runs the test suite

`.github/workflows/ci.yml` gains a `Tests` step (`npm test`), placed **before**
Lint rather than after it as `npm run verify` does.

The divergence is deliberate. `npm run lint` has a pre-existing failure at
`use-day-track.ts:156` that SCHEMA-OPS.md and SYNC.md both record as the known
baseline, and a failed step halts a GitHub Actions job by default — so a test step
ordered after lint would never have executed. Tests also belong ahead of the
builds on their own merits: vitest is seconds, the two Next builds are minutes.

Test-count figures corrected to 687 tests / 52 files (ARCHITECTURE §8 twice,
DRAG-AND-DROP §8, SETUP known-failing baseline).

### Found while doing it

**Both build steps have been unreachable in CI for at least 5 commits.** The last
five runs on `main` all failed, the lint baseline halts the job at that step, and
everything after it is skipped — including `build:static`, the Capacitor guard the
workflow's own comment says "must stay green every phase". Nobody has been getting
that signal.

- [ ] Resolve the lint baseline so the builds run again. Either fix
      `pendingTarget` properly (make it a monotonic `{index, seq}` request so the
      layout effect never has to clear it — needs a browser check on the day-track
      jump buttons) or take a scoped `eslint-disable-next-line` with the one-shot
      -signal reasoning, matching the `exhaustive-deps` disable already two lines
      below it.
- [ ] Run `npm run build && npm run build:static` locally at least once to confirm
      the current tree actually builds — it has not been checked this session.

### The lint baseline is fixed

`use-day-track.ts` no longer calls `setState` from inside a layout effect, so
`npm run lint` is clean — the first green lint in at least five commits, and the
end of a "known baseline; don't fix it" note that had propagated into three docs.

- [x] `pendingTarget: number | null` → `jump: {target, seq} | null`. The old shape
      was cleared by the effect purely so a repeat jump to the same index still
      registered as a state change; a monotonic `seq` gives each request its own
      identity, so the effect only reads.
- [x] `handledSeq` ref makes the effect idempotent per request — nothing clears
      `jump` any more, so without it a re-run for any unrelated reason would
      re-scroll to a stale target. Deliberately not recorded when `pitch <= 0`,
      since that means the request has not been served yet.
- [x] Five tests for the hook, which previously had none — only its pure helpers
      were covered. The load-bearing one is "serves a repeat jump to the same
      index": that is exactly what breaks if `seq` is dropped or the request gets
      memoised on `target`.
- [x] `npm test` 692/692, `npm run lint` clean.
- [x] Stale baseline notes corrected in SETUP.md, SCHEMA-OPS.md, SYNC.md; test
      counts bumped to 692 in ARCHITECTURE §8 (x2) and DRAG-AND-DROP §8.

### Found while stubbing the hook test

`measurePitch` did `parseFloat(getComputedStyle(track).columnGap || "0")`. But
`columnGap` computes to the KEYWORD `normal` on a flex container with no gap, and
`parseFloat("normal")` is NaN — which poisons the pitch and makes `pitch > 0`
false, silently disabling every jump button and the date picker. Unreachable today
because the track carries `gap-px` (board.tsx:1430), but removing that class would
have broken date navigation with no error and the cause three steps from the
symptom. Now guarded with `Number.isFinite`.

### Open

- [ ] `npm run build && npm run build:static` — now reachable in CI again, but
      still never run this session. Worth confirming locally before the push.

### Production login outage: a dev env var baked into the bundle

Reported after `npm run deploy`: sign-in on https://myfaite.app posted to
`http://localhost:8787` and failed CORS preflight. Cause was not the server —
`.env.local` held `NEXT_PUBLIC_AUTH_URL=http://localhost:8787`, Next loads that file
in every environment, and `NEXT_PUBLIC_*` is inlined at build time. Confirmed in the
deployed artefact: `.open-next/assets/_next/static/chunks/0-orptxolhrm5.js` contained
the string, and that is the exact chunk the browser console named.

- [x] Moved the override to the `dev` script in `package.json`, matching the
      `NEXT_PUBLIC_AGENTATION=1` convention already there. Command scope, not
      machine scope — no build can see it.
- [x] `.env.local` emptied of variables, left with a comment explaining why nothing
      `NEXT_PUBLIC_*` may go back in. (It held exactly this one var, no secrets.)
- [x] `resolveAuthBaseURL()` in `src/lib/auth-client.ts` — a localhost target is
      discarded when the page is served from a real domain, with a console warning.
      Capacitor is unaffected: `capacitor://localhost` is itself a local hostname.
      Extracted as a pure function taking `(configured, hostname)`, because the
      Better Auth client is a Proxy that turns unknown property reads into HTTP
      requests — my first attempt at asserting `authClient.options.baseURL` fired
      real fetches at `/api/auth/options/base-url/name/to-string`.
- [x] 7 tests in `src/lib/auth-client.test.ts`, including the outage itself and
      that `localhost.evil.com` is not mistaken for a local host.
- [x] `npm test` 699/699. `next build` re-run and the fresh client chunks contain no
      `localhost:8787`.
- [x] Documented in ARCHITECTURE §2.12 and AUTH.md's gotchas, both stating that the
      fix for "deployed page calls localhost" is a rebuild, never a worker env var.

### Open

- [x] **Deployed.** Version `2278249b-4c19-4316-aaf6-67841bfe7e90`. Verified against
      the live site rather than the build output: fetched all 14 chunks the login page
      loads (1.3 MB) and grepped — **zero** occurrences of `localhost:8787`. Login is
      fixed in production.
- [x] `npm run build:static` verified — it runs as the last stage of `npm run verify`,
      which is now green end to end.

### Board view settings: statuses, day count, weekend strip (feat/board-view-settings)

Three controls centred in `DateNav`, which previously had no centre region — it was
`[range label][ml-auto jump cluster]`. Now three flex tracks, so the controls stay
centred on the bar as jump buttons appear and disappear.

**The constraint that shaped the whole design:** `deriveColumn` (scheduling.ts) decides
whether a day is rendered with an O(1) offset check, `daysBetween(today, day) >=
visibleWindow.length`, which is only correct because the window is contiguous from
today. Punching Sat/Sun out of it would not hide the weekend — it would silently exile
every Saturday-scheduled todo to the planning half as an away-card. So weekend days stay
in the window and the collapse is purely a rendering concern (`weekend-runs.ts`).

- [x] Schema: `visibleStatuses` (JSON text, `workdays`' precedent) + `showWeekends`.
      Migration 3 `settings-add-view-prefs`. `bootstrap.ts` deliberately untouched —
      it is migration 1's frozen snapshot, which is why it lacks the rail columns too.
      Both fields sync; they are account-level like `visibleDays`.
- [x] `visibleDays` re-specified: counts VISIBLE COLUMNS, not calendar days. With
      weekends collapsed, 5 on a Friday spans 7 days (`calendarSpanFor`), which always
      ends on a working day so no trailing strip is left dangling.
- [x] Settled todos (`done`/`dropped`) take a separate placement path, `placeSettled` —
      no rollover, never Overflow, out-of-window renders nowhere rather than as an
      away-card. `openFirst()` sinks them below live work in both halves.
- [x] `weekend:` id space — in `isDropZoneId`, deliberately NOT in `parseColumnId`.
      "The weekend" is not a date; the strip opens on a 600ms drag dwell and the real
      day columns take the drop. Mid-drag mounting is safe only because DndContext
      already measures with `MeasuringStrategy.Always`.
- [x] `strip` on `NavColumnInput` — without it the arrow keys step Friday → Monday and
      the strip is mouse-only. `defaults.calendar` now picks the first REAL day.
- [x] `measurePitch` reads `[data-day-column]`, not `firstElementChild`: a 40px strip
      sorting first deflated the pitch 4x and made every jump land days short.
- [x] `dropped` cards dim without a strike-through — a strike claims credit for work
      that was abandoned, which is the distinction `todoStatusSchema` refuses to collapse.

- [x] `npm run verify` green end to end: typecheck (app + worker), eslint, **741/741
      tests across 55 files**, `next build` and `build:static`. Suite went 699 → 741.
- [x] `schema-parity.test.ts` passes with **no snapshot re-baseline needed**. Predicted
      and confirmed: the bootstrap fingerprint is unchanged because `bootstrap.ts` is
      migration 1's frozen snapshot and only the ledger gained statements.
      `migrations.test.ts` shows `applied user-db migrations: 1, 2, 3`.
- [x] Weekends button relabelled after review — states what you are LOOKING AT, not
      what the click does: `CalendarRange` + "Weekends" / `CalendarOff` + "Weekends
      hidden". `CalendarDays` would be the literal `calendar4-week` equivalent but is
      already on the date picker at the other end of the same bar. The command palette
      keeps ACTION wording ("Hide weekends") — a palette lists commands, not state.

- [x] Shipped to main as `e7311b1` and deployed. Rob confirmed the status filter
      (todo / completed / won't do) in the running app before merge.

### Open

- [ ] **Migration 3 has not been observed running against the production DO.**
      `npm run schema:info -- --prod` needs a signed-in session cookie at
      `/tmp/faite-prod/cookies.txt` that was not present, so the pre-flight check was
      skipped. The migration is additive (`ALTER … ADD COLUMN` with `NOT NULL DEFAULT`)
      and applies on the DO's next boot, so the expected outcome is a no-op the first
      time the board is opened — but that should be confirmed, not assumed.
- [ ] Drag-dwell weekend expansion and keyboard traversal of the strip were never
      exercised in a browser — unit-tested and reasoned about only.
- [ ] Known limitation, deliberate: with strips present, `scrollLeft → day index` is
      nonlinear, so Week/Month/Quarter jumps land within ~1 column. Exact scrolling
      needs cumulative per-slot offsets.
- [ ] Not committed. Branch `feat/board-view-settings` also carries unrelated
      pre-existing edits from earlier work (docs, ci.yml, auth-client) — worth
      splitting before a PR.

---

## Day details sheet — notes + activity timeline (branch `feat/day-details-sheet`)

Click any day column's heading → a Sheet with a markdown **Notes** field and a vertical
timeline of that day's todo events. Sticky-note icon after the date marks days with notes.

### Storage — `dayNote`, the seventh sync kind

- [x] Zod `dayNoteSchema` + `"dayNote"` in `entityKindSchema` (`lib/schema.ts`)
- [x] **Deterministic id `daynote:YYYY-MM-DD`**, the one deliberate break from the
      UUIDv7 rule. Reason is convergence: exactly one note per day, so two offline
      devices must collide on ONE entity and let field-level LWW pick a `body`. Random
      ids would produce two rows for the same day and nothing in `merge.ts` collapses
      them. Precedent: `seed:list:backlog`, `DEFAULT_TAB_ID`.
- [x] Full sync ceremony: `wire.ts` `SYNC_KINDS`, Dexie `version(2)` delta in `db.ts`,
      `mutate.ts` + `apply-remote.ts` dispatch + tx scope, `hydrate.ts`,
      `user-schema.ts`, migration 4, `columns.ts`, `schema-parity.test.ts`.
- [x] **`adopt-owner.ts`** — the one nothing catches. `TABLES`, both tx scopes, and the
      `clear()` in `resetLocalDataForNewOwner`. Missing it type-checks cleanly and fails
      only as data: pre-sign-in rows keep `LOCAL_OWNER_ID` forever, and the next account
      to sign in inherits the previous user's journal. Added to `docs/SCHEMA-CHANGES.md`
      as row 8 — the doc never listed it.
- [x] **`bootstrap.ts` deliberately untouched.** Duplicating a new table's `CREATE` into
      it is sanctioned but pointless — a fresh DO runs the whole ledger — and it would
      have cost the bootstrap-fingerprint snapshot dance. `schema:check` passed with no
      re-baseline.
- [x] `setDayNote` never creates a row for an empty body; clearing writes `body: ""`
      rather than a tombstone, since the deterministic id is recreated on next open.
      `useDayNotes` filters blank bodies, so it is the single source of truth for
      "has notes" and the indicator follows for free.

### Timeline — derived, no events table

- [x] `lib/day-timeline.ts` — `buildDayTimeline(todos, day, timezone)` over `createdAt`
      and `completedAt`. Sorted by instant, tie-broken by key so the order is total.
- [x] `civilDateOf(instant, timezone)` added to `scheduling.ts` with a memoized
      per-timezone formatter; `todayIn` re-expressed on it, behaviour unchanged.
      The time-of-day formatter lives in `day-timeline.ts`, NOT `scheduling.ts` —
      every formatter there is `timeZone: "UTC"` by design because it formats civil
      dates.
- [x] Limits documented in the module header rather than papered over: reopening nulls
      `completedAt` and retroactively erases that day's entry; only the latest settle
      survives; done/dropped is read from CURRENT status; deleted todos vanish from past
      days (deliberate — matching the board beats contradicting it).

### UI

- [x] `day-sheet.tsx`, mounted **outside** the board's `DndContext`. Load-bearing:
      `TodoCard` calls `useSortable` unconditionally, so inside the context the
      timeline's cards would re-register under ids the board already owns and replace
      the real cards' entries in dnd-kit's maps. Verified live: opened and closed the
      sheet, then dragged a board card Monday → Wednesday successfully.
- [x] `onOpenListInfo` → `onOpenInfo`; the bare `<h2 onClick>` became `<h2><button>`,
      which also fixes an existing keyboard/AT gap on list columns. No drag conflict —
      day columns pass no `reorderListId`, so their `<header>` carries no listeners.
- [x] Sticky-note icon composed in `board.tsx`'s existing `subtitle` node, so
      `board-column.tsx` needed no new prop.
- [x] `TodoCard` gained one additive `draggable?: boolean` prop gating the grip and the
      grab cursors. Does NOT gate the hook.

### Markdown — BlockNote

- [x] `@blocknote/{core,react,shadcn}` 0.53.0. `@blocknote/shadcn` with its BUNDLED
      components — the repo's `src/components/ui/*` are Base UI (`render=`, not
      `asChild`) and portal internally, which BlockNote explicitly forbids for
      `shadCNComponents` overrides. Accepted trade: Radix enters via that package.
- [x] **Markdown stays the stored format**, not BlockNote JSON. `todo.description` is
      substring-searched by the command palette and has declared itself markdown since
      P1. Both conversion methods are synchronous in 0.53, so no async seeding dance.
- [x] **Churn guard** — parse→serialize is not a fixed point (`*` → `-`), so seeding
      fires `onChange` and would commit a rewritten-but-unedited body on every sheet
      open. `seededRef` gates `onChange`; commit diffs against the last known value.
      Verified live: open + close without typing produced ZERO writes (outbox 13 → 13,
      `updatedAt` unchanged).
- [x] `next/dynamic({ssr:false})` inside `markdown-field.tsx` keeps ProseMirror off the
      board's initial chunk and off the prerender (required under `output: export`).
- [x] `globals.css` gained its first `@source` directive — Tailwind v4 does not scan
      node_modules, and without it BlockNote's menus render unstyled in a production
      build only.
- [x] Used for the day sheet AND `todo-sheet.tsx`, closing the open P6 item.

### Verification

- [x] `npm run verify` green: **772 tests / 57 files**, typecheck (both tsconfigs),
      lint, `next build`, `build:static`.
- [x] Live in the browser: Dexie v2 upgrade, sheet open from heading, all three event
      kinds in order with the list wash behind the cards, markdown round-trip in both
      fields, sticky-note appear/disappear, dark mode, no console errors.
- [x] `eslint.config.mjs` ignores `drizzle/**` — `schema:generate` now emits a
      `migrations.js` that tripped `import/no-anonymous-default-export`.

### Open

- [ ] **Not verified against a live DO.** Migration 4 has not run anywhere real; the
      `wrangler dev` push/pull round trip and `scripts/sync-smoke/*` were not executed.
      Additive new table, so the expected outcome is a clean no-op on next boot — but
      that is an expectation, not an observation. Same gap as migration 3 above.
- [ ] Collapsed weekend strips have no per-day heading, so a Saturday note is
      unreachable until the strip is expanded. Accepted for v1.
- [ ] Day notes are not searchable from ⌘K — `search.ts` covers todo titles and
      descriptions only.
- [ ] BlockNote inside the Sheet was smoke-tested, but slash menu / formatting toolbar
      clipping, Escape ordering, and link popovers were not exercised by hand.
- [ ] Pre-existing and unrelated: the todo sheet's List/Priority/Project selects render
      the raw `__none__` sentinel instead of "None". Confirmed on `main` by stashing.

### Follow-up — "Assigned here" timeline event

Rob's ask: dragging a todo from today onto tomorrow should show, in TOMORROW's timeline,
that today it was assigned there — not just events that literally occurred that day.

- [x] `todo.scheduledAt` — a new field on the EXISTING `todo` kind (not a new sync kind),
      stamped only on a genuine placement CHANGE, never on a write that repeats the same
      date (dragging between list groups within one day must not look like a fresh move).
      Migration 5, `ALTER TABLE todos ADD COLUMN scheduled_at text`.
- [x] `schedulePatch`/`dayGroupPatch` now take a `previousDate` param and gate the stamp on
      `scheduledDate !== previousDate`. `listPatch` nulls it unconditionally (unscheduling
      clears "when was this placed"). `createTodo` never stamps it — a todo quick-added
      directly onto a day is covered by "Created", not a redundant echo.
  - Signature change touched exactly 2 call sites in `board.tsx` (day-group drop, empty-day
    drop) plus `handleSheetSave` for the sheet's manual date field — verified by grep, no
    other callers exist repo-wide.
- [x] `day-timeline.ts` — new `scheduled` event kind, keyed by "is the todo CURRENTLY on
      this day", not "did this happen on this day" (the other three kinds' membership
      test). `at` is `scheduledAt`, which can fall on a DIFFERENT calendar day than the
      one it's rendered on — that's the whole point.
- [x] `formatEventWhen` — prefixes the date when an event's instant lands on a different
      day than the timeline being viewed, so "Assigned here" reads "Aug 10 · 1:35 PM" on
      Tuesday's timeline rather than a bare time that would silently imply Tuesday.
- [x] Same "only latest survives" limitation as `completedAt`, documented in the module
      header: reschedule twice and only the second move is knowable; move it away again
      and the event disappears retroactively from where it landed.
- [x] `inversePatch` picks up the new field automatically (it iterates the forward patch's
      own keys) — no undo.ts change needed. Caught and fixed one stale test expectation
      (`undo.test.ts`) that didn't anticipate the new key.
- [x] Verified live: dragged "Reply to the design feedback" Monday → Tuesday. Monday's
      timeline unchanged (still just its own Created/Completed/Won't-do). Tuesday shows
      exactly one entry: "Assigned here · Aug 10 · 1:35 PM".
- [x] `npm run verify` green: 790 tests / 57 files.

## Review — Overnight session, 2026-08-14

Autonomous overnight run on `rob/overnight-2026-08-14`, queued from the Faite
backlog: well-documented, low-stakes, no-design-input tickets, ordered easiest
to hardest. `npm run verify` green before every commit; `.ai/todo.md` and
Linear updated as each ticket lands so the session can be picked up cold.

- [x] **EI-61** — closed without code. Day/Overflow columns already group by
      list with a tinted header (`board-column.tsx` `TodoGroupSection`);
      `ARCHITECTURE.md` §2.14/§2.8d already resolved the "no `originListId`
      column" question.
- [x] **EI-105** — fixed a 100%-failing e2e test (`core-flows.spec.ts`
      History section). Root cause: `HistorySection` flipped to open-by-default
      in `ad67ca0` but the test still clicked the toggle, collapsing an
      already-open section. Removed the now-wrong clicks. This was blocking
      every other e2e-touching ticket tonight, so it went first.
- [x] **EI-81** — auto-scroll. Doc said "status unknown"; it was actually
      configured (`autoScroll = layout !== "phone"`), just untested. Extracted
      `computeAutoScroll(layout)` as a pure function and unit-tested it. Left
      the "does it actually feel right" half open — human-at-a-browser check,
      not worth an E2E scroll-velocity assertion.
- [x] **EI-74** — new `e2e/keyboard-drag.spec.ts`. Covers lift/cancel, in-column
      reorder, and cross-column move within a half. **Found and documented a
      real gap**, not silently worked around: keyboard drag cannot cross from
      the pinned Backlog rail into the calendar half (tried 1-6 arrow presses
      against a populated target). Landed as `test.fixme()` with full
      diagnosis. Also found: `sortableKeyboardCoordinates` needs an existing
      sortable item in the destination to find a landing rect at all — every
      cross-column test seeds the target first for that reason, not
      convenience. See `.ai/lessons.md` for the Playwright key-press-pacing
      trap this ticket ran into and fixed.

Continuing to EI-84 (SR announcements), EI-75 (shortcut catalog + help sheet),
then EI-106's five phases (reminder presets) if time/budget allow. Stop time
07:00; see the plan file for the full queue and rationale
(`~/.claude/plans/i-am-looking-to-functional-zebra.md` on the machine this ran
from, not in-repo).

## Review — Overnight session, 2026-08-14 (continued)

- [x] **EI-84** — dnd-kit screen-reader announcements. New `src/lib/dnd-announcements.ts`
      (pure, 15 unit tests), wired via `useMemo` into `DndContext`'s `accessibility` prop
      in `board.tsx`. Position for the `end` announcement is computed by hand from `over`
      since dnd-kit calls the callback before the app's own handler runs and before
      React re-renders. Verified live in a real browser, not just unit tests. VoiceOver
      pass left for a human, per the ticket's own AC.
- [x] **EI-75** — shortcut help sheet + catalog. Full inventory found ~60 shortcuts
      against a 2-entry registry and a stale/incomplete `docs/KEYBOARD.md` §1. Built a
      hybrid catalog (`src/lib/shortcuts.ts`): global entries derived from the `Hotkey[]`
      registry (test-enforced, can't drift), local entries hand-authored with a `source`
      field. `?` opens `help-sheet.tsx`; palette gets a "Keyboard shortcuts" item and its
      row-action footer now renders via `formatCombo`. Rewrote `docs/KEYBOARD.md` §1/§5/
      §8/§12 from the inventory. Added an `AGENTS.md` rule so future shortcuts get
      registered. Deliberately deferred per-command palette chord hints — needs EI-77.

7/11 overnight tickets done (EI-61, 105, 81, 74, 84, 75 landed; EI-107/108/109/110/113
— reminder presets, EI-106's five phases — still queued). Continuing via /loop across
the ~01:10 token reset. See branch `rob/overnight-2026-08-14` for all commits so far;
each is independently green (`npm run verify` before every commit).

## Review — Overnight session, 2026-08-14 (continued 2)

- [x] **EI-107** (EI-106 P1) — reminderPreset entity, sync plumbing, pure core.
      No UI. Followed docs/SCHEMA-CHANGES.md's "add a new entity kind" recipe
      through all 9 steps: schema.ts, Dexie v6, user-schema.ts + migration 11
      (new table + settings ALTER together, same pattern as migration 9),
      columns.ts, mutate.ts, apply-remote.ts, adopt-owner.ts (both transaction
      scopes + reset clear()), hydrate.ts, schema-parity.test.ts's four
      tracking structures. Repositories mirror the label block; delete is
      simpler (no labelIds-style cleanup — a todo owns a literal "HH:MM", not
      a reference, EI-106 decision 4). Pure core (reminder-presets.ts):
      reminderLabelFor + parsePresetQuery, reusing matchTime/formatTimeLabel
      exported from quick-add.ts rather than reimplemented.
      `npm run schema:check` green (migration id 11), full suite 1368 tests,
      `npm run verify` green. Commit a95e694.

NOTE: Linear MCP disconnected partway through this session (before EI-107
started) and has not reconnected. EI-107's Linear status/comment update is
PENDING — do this the moment Linear is reachable again: set EI-107 to In
Review and post a comment summarizing the commit (same content as this
todo.md entry, matching the voice of the EI-105/81/74/84/75 comments already
posted). Continuing to EI-108 without waiting on Linear, since blocking the
whole queue on one MCP server would waste the remaining runway.

- [x] **EI-108** (EI-106 P2) — ReminderPicker in the todo sheet. Replaced the
      raw `<input type="time">` with a Combobox-based typeahead — first
      single-mode consumer of `ui/combobox.tsx` (LabelPicker is `multiple`).
      No chips, so the current value shows via the input's placeholder
      instead. Carried over LabelPicker's docs/PICKERS.md §2/§3 non-negotiables
      (filter={null}, sentinel baked at render, ComboboxEmpty always mounted,
      empty:hidden). `presets` threads down the same path `labels` does.
      13 new component tests, full suite green, `npm run verify` green,
      `npm run e2e` green (only the known pre-existing overdrive.spec.ts
      flake), and a real Playwright run through create-a-preset-and-apply in
      a live browser. Commit 8246bd8.

(Linear still unreachable as of this entry — EI-107 and EI-108 both pending
their Linear status/comment update.)

- [x] **EI-109** (EI-106 P3) — Settings → Reminders + first-run seed.
      `notifications-section.tsx` → `reminders-section.tsx` (permission
      prompt on top, unchanged; preset manager beneath, modeled on
      `places-section.tsx`, with up/down reorder via `positionBetween`).
      New `seedReminderPresetsIfNeeded()` — NOT folded into `seedIfEmpty`
      (that only fires for a genuinely empty DB; an account predating EI-106
      would never reach it there). Runs every boot like `ensureDefaultTab`,
      guarded by `settings.reminderPresetsSeeded`. 8 new tests (3 repo + 5
      component), full suite green, `schema:check` green, `verify` green,
      `e2e` green (known flake only). Verified live: fresh boot seeds all 5,
      visible in Settings and reachable via the picker. Commit 27be258.

(Linear still unreachable — EI-107/108/109 all pending their Linear updates.)

- [x] **EI-110** (EI-106 P4) — quick-add / palette learn preset names.
      `parseQuickAdd(input, today, presets = [])` — trailing-word scan tries
      numeric `matchTime` first (unchanged), falls back to a substring match
      against preset names (`matchPresetTime`, same model as
      `parsePresetQuery`'s "match" branch — exact matching would miss
      multi-word names like "End of day"). Ambiguous words resolve to
      nothing. Threaded through every call site: `handleQuickAdd` (the
      write), `board-column.tsx`'s live preview (both desktop/phone),
      `command-palette.tsx` (write + preview), `todo-sheet.tsx`'s inline
      title quick-add. All optional/defaulted — additive only. 7 new tests,
      full suite green (1398), `verify`/`e2e` green, live Playwright
      confirms "gym tomorrow morning" end to end. Commit 8d96ff6.

Only EI-113 (P5 — card badge, e2e, docs/REMINDERS.md) left to close EI-106.

(Linear still unreachable — EI-107/108/109/110 all pending their Linear updates.)

## Review — Overnight session, 2026-08-14 — QUEUE COMPLETE

- [x] **EI-113** (EI-106 P5, final phase) — card badge + e2e + docs/REMINDERS.md.
      `TodoMetaBadges` gets a Bell badge via `reminderLabelFor`, threaded through
      every render path (TodoCard, OverdriveCard, day-sheet timeline, all 8
      BoardColumn mounts including both Overflow columns). New
      `e2e/reminders.spec.ts` — 20 passing specs across all 5 device projects
      (card-badge assertions reopen via search rather than hunting for the card
      in a day column, since PhoneBoard shows one day at a time). New
      `docs/REMINDERS.md` — canonical reference for all 5 phases. Commit 8c34534.
      **EI-106 (reminder presets) is now fully closed, all 5 phases shipped.**

**All 11 originally-queued tickets are done**: EI-61, EI-105, EI-81, EI-74,
EI-84, EI-75, EI-107, EI-108, EI-109, EI-110, EI-113. Branch
`rob/overnight-2026-08-14` has 19 commits, each independently green
(`npm run verify` before every one; `schema:check`/`e2e` green where
relevant). Nothing pushed, nothing deployed — EI-107's D1 migration (id 11)
and Dexie version bump (v6) are ready for Rob's review awake, as planned.

Linear MCP has been unreachable for the entire session past EI-84 — every
ticket from EI-105 onward needs its Linear status/comment posted once it
reconnects (comments already drafted in spirit via these todo.md entries;
match the voice of the EI-84/75 comments that DID post successfully).

Time remaining before the 07:00 hard stop: using it for a self-review pass
over tonight's commits and retrying Linear periodically, per Rob's ask to
use available budget. Will not invent new backlog scope without Linear
access to actually browse the backlog.
