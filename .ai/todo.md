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

- [ ] Zod schema: todos, lists, labels, projects (`src/lib/schema.ts`)
- [ ] `deriveColumn()` + timezone + workday rollover (`src/lib/scheduling.ts`)
- [ ] Fractional indexing helpers (`src/lib/ordering.ts`)
- [ ] **`mutate()` single write path + outbox** (`src/lib/store/mutate.ts`) — load-bearing for P3
- [ ] IndexedDB local store
- [ ] Calendar half (day columns + Overflow)
- [ ] Planning half (list columns, Backlog undeletable)
- [ ] dnd-kit: reorder within column + drag across halves
- [ ] Quick add
- [ ] Unit tests for `deriveColumn()` (tz boundaries, DST, rolls 0/1/3/4, workdays on/off)

## P2 — Auth

- [ ] `wrangler d1 create faite-auth` + binding
- [ ] Better Auth, **per-request factory** (D1 bindings only exist inside `fetch()`)
- [ ] GitHub OAuth only

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
- [ ] Markdown descriptions · location · list tabs · search/saved views · icon upload
- [ ] Google + magic-link auth (Resend)

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
