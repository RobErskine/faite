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

- [ ] DO SQLite schema + Drizzle (`drizzle(ctx.storage)`)
- [ ] HLC + field-level LWW
- [ ] Outbox drain, `since=version` pull, focus + interval trigger

## P4 — Sync v1
- [ ] WebSocket push, hibernation, reconnect/backfill, multi-tab

## P5 — API + docs
- [ ] Zod → OpenAPI, tokens, rate limits

## P6 — Fast follow
- [ ] Projects + views · sub-tasks · recurrence (RRULE + exceptions) · priority 1–4
- [x] List tabs (pulled forward — grouping, colour, drag-sort, cross-tab carry)
- [ ] Markdown descriptions · location · search/saved views · icon upload
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
