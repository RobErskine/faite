# Schema scripts

Managing the per-user Durable Object's schema. The **why** lives in
`docs/SCHEMA-CHANGES.md`; the **procedure** lives in `docs/SCHEMA-OPS.md`.
This file is just what the commands are and how to authenticate them.

| Command | What it does | Needs a server |
|---|---|---|
| `npm run schema:generate` | `drizzle-kit generate` for the DO config | no |
| `npm run schema:check` | parity + migration tests, fast | no |
| `npm run schema:snapshot` | update the bootstrap fingerprint | no |
| `npm run schema:info` | schema state of your own DO | yes |
| `npm run schema:reset` | wipe your own board, server-side | yes |

Add `-- --prod` to the last two to target `myfaite.app` instead of local.

## Why `schema:info` exists

A Durable Object's SQLite has **no external query endpoint** — unlike D1,
which is reachable through the Cloudflare API (`docs/SYNC.md` covers that
asymmetry). Without this you cannot confirm a migration actually applied to a
real account except by shipping a change and reading `wrangler tail`.

## Auth

Both server-touching scripts reuse `scripts/sync-smoke/harness.mjs`'s cookie
loader, so **local uses the same cookie jar the smoke harnesses do** — follow
`scripts/sync-smoke/README.md`'s setup and you are done.

For `--prod` you need a separate jar, because local D1 is a completely
different database from production and the accounts do not overlap
(`docs/SETUP.md`):

```bash
mkdir -p /tmp/faite-prod
curl -s -X POST https://myfaite.app/api/auth/sign-in/email \
  -H 'Content-Type: application/json' -H 'Origin: https://myfaite.app' \
  -d '{"email":"you@example.com","password":"..."}' \
  -c /tmp/faite-prod/cookies.txt
```

Override either path with `FAITE_SMOKE_COOKIES` / `FAITE_PROD_COOKIES`.

> curl writes httpOnly cookies with a literal `#HttpOnly_` prefix, so the
> obvious "skip lines starting with `#`" filter drops exactly the session
> cookie and every request 401s like an auth bug. `loadCookie` already handles
> this — don't reimplement it.

## `schema:reset` is the server half only

A node script cannot reach a browser's IndexedDB or localStorage. Open tabs
keep their local board and their pull cursor, and will push that board back up
on the next cycle.

That used to be the dangerous part. It isn't any more: the DO detects a cursor
above its own `next_version` — provably only reachable after a wipe — and
tells the client to re-pull from 0 (`PullResponse.reset`). A device left open
heals within one sync cycle instead of going silently dead.

To wipe **everything** including local state, use the in-app reset, which
calls `resetAccountData()` (`src/lib/store/reset.ts`) and does both halves in
the right order.
