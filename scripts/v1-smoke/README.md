# `/api/v1` smoke harnesses

Node scripts that drive the **public API** against a real Durable Object over
real HTTP, with a real API key — no browser, no client code, no mocks.

They exist for the same reason `scripts/sync-smoke/` does: the route tests in
`src/server/v1/routes.test.ts` mock the auth seam and fake the DO stub, which
is exactly right for dispatch and status codes and says nothing about whether
a key actually authenticates, whether a scope actually gates, or whether a
write actually reaches storage. Everything decidable was pushed into pure
modules and unit-tested; this is the layer that needs a running runtime.

Re-run them after any change to `v1/routes.ts`, `user-do.ts`, `auth-scopes.ts`
or `auth-tokens.ts`.

## Setup

Local D1 is a **separate database** from production, and each git worktree has
its own `.wrangler` state — so a fresh worktree starts with no tables and no
account (`docs/SETUP.md`).

```bash
# 1. The worker needs an OpenNext bundle, not just `next build`.
npx opennextjs-cloudflare build

# 2. Auth tables. A fresh worktree has none, and sign-up 500s with
#    "no such table: user" until this runs.
npm run auth:migrate:local

# 3. Isolated dev server. Check the port is free FIRST -- 8787 is the
#    conventional preview port and may be someone's running preview.
lsof -nP -iTCP:8790 -sTCP:LISTEN || echo "8790 free"
npx wrangler dev --port 8790

# 4. An account. Verification is nominally off on localhost, but wrangler
#    dev's socket proxying means the hostname check doesn't always see a bare
#    "localhost" -- same known issue `sync-smoke/README.md` documents.
mkdir -p /tmp/faite-verify
curl -s -X POST http://localhost:8790/api/auth/sign-up/email \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8787' \
  -d '{"email":"v1-smoke@example.com","password":"correct-horse-battery-1","name":"V1 Smoke"}' \
  -c /tmp/faite-verify/cookies.txt
npx wrangler d1 execute AUTH_DB --local \
  --command "UPDATE user SET email_verified = 1 WHERE email = 'v1-smoke@example.com';"
curl -s -X POST http://localhost:8790/api/auth/sign-in/email \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8787' \
  -d '{"email":"v1-smoke@example.com","password":"correct-horse-battery-1"}' \
  -c /tmp/faite-verify/cookies.txt

# 5. A read-write key, saved where the scripts look for it.
curl -s -X POST http://localhost:8790/api/auth/api-key/create \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8787' \
  -b /tmp/faite-verify/cookies.txt \
  -d '{"name":"V1 Smoke","configId":"read-write"}' \
  | node -e "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).key))" \
  > /tmp/faite-verify/key.txt
```

**A `#HttpOnly_` line in curl's cookie jar is a real cookie, not a comment.**
The session token is one, so a parser that drops every line starting with `#`
drops exactly the cookie that matters and every request comes back 401. Both
scripts here handle it; anything new should too.

Override with `FAITE_SMOKE_PORT`, `FAITE_SMOKE_COOKIES` and `FAITE_SMOKE_KEY`.

## Running

```bash
node scripts/v1-smoke/seed.mjs             # seeds a board -- run once, first
node scripts/v1-smoke/smoke.mjs            # 40 assertions across A13-A17
node scripts/v1-smoke/sync-visibility.mjs  # 11 assertions -- the important ones
```

### `seed.mjs` — a board to test against

A server-side account has **no tab, no Backlog and no lists** until a client
seeds one: `seedIfEmpty()` is client-side and never runs for an account that
only ever sees the API. Nothing in `/api/v1` can create a Backlog either —
`isBacklog` is deliberately not settable — so this seeds through
`/api/sync/push` with the cookie session, which has full access.

That is worth knowing beyond this script: **an API-only account has no
Backlog**, so `GET /api/v1/backlog` is empty and a list delete rehomes its
to-dos to `null` rather than to Backlog.

### `smoke.mjs` — the public surface

Derived reads (overflow placement, profile field list, no `version` leak);
day notes (upsert, derived id, empty-body no-op vs. clear, range exclusion, no
DELETE); list CRUD including the `isBacklog` PATCH regression and the
rehome-to-Backlog cascade; label stripping and tab rehoming; todo filters and
the deliberate absence of an implicit page size.

### `sync-visibility.mjs` — the one that actually matters

`docs/API.md`: **"a REST/MCP write is not a database write. It is a push."**

A write that skips `push()` still returns 200 and still shows up in a
subsequent GET — it looks completely fine from the API's own side. What breaks
is every *other* device: no version is allocated, so a caught-up client's
`WHERE version > cursor` never sees it, and the next client push silently
overwrites it. That failure is invisible to `smoke.mjs` by construction.

So this one writes through the REST API and then **pulls as a sync client
would**, asserting the cursor advanced and the row came back — for a create
and for a delete's tombstone. It also proves a real read-only key is refused
(403) on every write route, and that the CORS preflight advertises the methods
the API actually serves (EI-307).
