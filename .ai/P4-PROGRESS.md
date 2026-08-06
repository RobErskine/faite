# P4 / EI-49 — shipped to production

**Status: complete, merged, deployed, and confirmed live by Rob's own
two-browser test.** Nothing outstanding.

- Merged to `main` and pushed: `23675ce..3bed126` (15 commits — 8 P4, plus
  the 7 P3 data-loss fixes that had never been deployed).
- Cloudflare **version 17 (`3b7e83fa`)**, deployed 2026-08-06 15:07 UTC.
- Live at https://myfaite.app — polled healthy on `/`, `/board`, `/login`,
  `/api/auth/get-session`.
- Linear: [EI-49](https://linear.app/rob-erskine/issue/EI-49/websocket-live-push-with-hibernation)
- Full write-up: `docs/SYNC.md` → "P4 (EI-49) — WebSocket live push, shipped"
- Retrospective: `.ai/todo.md` → "Review — P4 (EI-49...)"
- Lessons: `.ai/lessons.md` → last three entries

## Phase status — all complete

| Phase | What | Commit |
|---|---|---|
| 0 | bound-param chunking + `wipe()` re-bootstrap | `528e33f` |
| 1 | `ws-protocol.ts`, `validate.ts`, `backoff.ts` (pure) | `12c5ba3` |
| 2 | `/api/sync/ws` + DO `fetch()` upgrade + handlers | `42a2998` |
| 3 | `ws-transport.ts` + fallback routing + provider wiring | `80e8562` |
| 4 | broadcast-on-write + `notifyRemoteChange` | `3cee615` |
| 5 | adaptive interval + docs + smoke harnesses | `5e3451e` |
| — | self-review fix: per-socket `openedAt` | `af48e25` |

## Verification

Automated: typecheck (both projects), **525 tests**, both build targets,
`wrangler deploy --dry-run`. Lint has one pre-existing error at
`use-day-track.ts:156` — the known baseline, not ours, don't fix.

Against a real Durable Object (`scripts/sync-smoke/`, isolated `wrangler dev`
on 8790): `smoke.mjs` **18/18**, `broadcast.mjs` **12/12**, `hibernate.mjs`
**passed** (170s idle, then push/pull on the same socket).

**Rob's acceptance test passed** — two browsers, live push confirmed working.
That was the real bar; the harnesses only ever proved the protocol.

## Landed after the deploy

Follow-ups from the post-deploy conversation, all on `main`:

- **Durable Object schema migrations** (`src/server/db/migrations.ts`).
  Rob flagged upcoming data-shape changes; investigating found a guaranteed
  break. `bootstrap.ts` is `CREATE TABLE IF NOT EXISTS`, a no-op on an
  existing table, so a new **column** would reach new accounts and never
  reach anyone with data — and the first push naming it would throw
  `no such column` inside `push()`'s transaction, killing pushes permanently
  while pulls kept working. Now a ledgered, transactional, ordered migration
  runner. **Verified against a real DO that already had data**: added a
  column, restarted, watched `[faite] applied user-db migrations: 2`, pushed
  a row carrying the new field (the exact operation that used to throw), and
  confirmed it round-tripped with pre-migration rows intact.
- **`docs/SCHEMA-CHANGES.md`** — the seven files a field lives in, recipes
  for add/rename/remove/new-kind, why renames fork under field-level LWW, and
  why deployment skew forces additive-only changes.
- **`workers_dev: true`** — branch previews had never worked. Preview URLs are
  only served on the workers.dev subdomain, so `workers_dev: false` disabled
  them silently while the API still reported `previews_enabled: true`. The old
  comment claiming `preview_urls` was "load-bearing for CI/CD" was wrong and
  is corrected in place.

## Known limits, deliberately accepted

- **`wipe()` is still unverified end-to-end.** Same blocker as P3: the
  `/delete-user` endpoint's CSRF Origin check rejects a non-`TRUSTED_ORIGINS`
  port. P4 phase 0 changed it (close sockets → delete → re-bootstrap), so it
  is reasoned, reviewed, and unexercised. Worth one disposable account
  against a preview now that previews work.
- **`MAX_SOCKET_AGE_MS` is 1 hour**, chosen without usage data. Bounds but
  does not eliminate the window where a socket outlives the session that
  authorised it. Blast radius is one user's own board, never cross-account.
- **Capacitor (P7) stays on the HTTP fallback.** The `WebSocket` constructor
  has no `credentials` option, so cookies follow SameSite and
  `capacitor://localhost` → `myfaite.app` is cross-site.
- **GitHub OAuth does not work on previews** — a GitHub OAuth App accepts one
  callback URL and it points at production. Use email/password there.

## If something looks wrong in production

1. `docs/SYNC.md`'s P4 section lists every mechanism and where it lives.
2. DevTools → Network → WS: you should see `/api/sync/ws` open, with
   `changed` frames arriving when another device writes.
3. No socket is not a failure — the fallback polls over HTTP. Check for a
   quiet `[faite] sync socket paused…` warning in the console.
4. **Never "reset" a DO to fix things.** `deleteAll()` resets
   `sync_meta.next_version` to 1, stranding every device's cursor above it
   and killing sync everywhere at once. Use a new account instead.
