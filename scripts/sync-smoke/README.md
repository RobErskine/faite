# Sync smoke harnesses

Node scripts that drive `/api/sync/*` against a **real** Durable Object over a
**real** WebSocket, with no browser and no client code involved.

They exist because `@cloudflare/vitest-pool-workers` is banned in this repo
(see `docs/SYNC.md`), so a hibernating DO and a live socket are both
unreachable from plain vitest. Everything decidable was pushed down into pure
modules and unit-tested; what's left is exactly the stuff that needs a running
runtime. These scripts are that layer, kept so it can be re-run rather than
re-derived.

They caught nothing on the first pass (the code was already right), but they
are what makes the claim "P4 works" mean something. Re-run them after any
change to `user-do.ts`, `routes.ts`, `ws-server.ts`, or `ws-protocol.ts`.

## Setup

```bash
# 1. Isolated dev server. Check the port is free FIRST and kill only your own
#    PID afterwards -- 8787 is the conventional port and may be someone's
#    running preview.
lsof -nP -iTCP:8790 -sTCP:LISTEN || echo "8790 free"
npx wrangler dev --port 8790

# 2. A local account. Local D1 is a SEPARATE database from production, so
#    your real account does not exist here (docs/SETUP.md).
mkdir -p /tmp/faite-p4
curl -s -X POST http://localhost:8790/api/auth/sign-up/email \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8787' \
  -d '{"email":"p4-smoke@example.com","password":"correct-horse-battery-1","name":"P4 Smoke"}' \
  -c /tmp/faite-p4/cookies.txt

# 3. Verification is nominally off on localhost, but wrangler dev's socket
#    proxying means the hostname check doesn't always see a bare "localhost",
#    so sign-in 403s with EMAIL_NOT_VERIFIED. Known, pre-existing, documented
#    in .ai/todo.md's P3 review. Workaround:
npx wrangler d1 execute faite-auth --local \
  --command "UPDATE user SET email_verified = 1 WHERE email = 'p4-smoke@example.com';"

curl -s -X POST http://localhost:8790/api/auth/sign-in/email \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:8787' \
  -d '{"email":"p4-smoke@example.com","password":"correct-horse-battery-1"}' \
  -c /tmp/faite-p4/cookies.txt
```

Override with `FAITE_SMOKE_PORT` and `FAITE_SMOKE_COOKIES` if you need to.

## Running

```bash
node scripts/sync-smoke/smoke.mjs        # ~5s   -- 18 assertions
node scripts/sync-smoke/broadcast.mjs    # ~5s   -- 12 assertions
node scripts/sync-smoke/hibernate.mjs    # ~3min --  1 verdict
```

### `smoke.mjs` — handshake guards, round trips, hostile input

Handshake: unauthenticated upgrade is 401; a hostile `Origin` is 403 (the
CSWSH boundary — a WebSocket handshake bypasses CORS entirely, so this check
is the only thing between evil.com and a signed-in board); a plain GET is 426;
an absent `Origin` is allowed, because browsers cannot omit it and a
non-browser client still needs the cookie.

Round trips: push and pull over the socket return byte-shape-identical
responses to the HTTP route.

Validation: wrong protocol version and negative cursor are rejected, an absurd
`limit` is clamped rather than fatal, and a 501-entry batch is rejected —
these are the guards that live in `routes.ts`, not in `push()`/`pull()`, so
the socket path would silently skip them if it didn't share `validate.ts`.

Hostile input: a barrage of malformed and binary frames leaves the socket
serving, **and leaves a second concurrent socket serving** — the real risk is
that an uncaught throw out of `webSocketMessage` breaks the stub for every
socket attached to the object, so one tab's bad frame disconnecting another
device is the failure being ruled out.

### `broadcast.mjs` — live push fan-out

Three sockets. A write on A reaches B and C but not A; the frame carries the
version that caused it (which is what lets a receiver skip a redundant pull);
a no-op push broadcasts nothing; an HTTP push notifies all three (a device on
the polling fallback must be able to wake a device on a socket); and after
abruptly `terminate()`-ing one socket, a further push still acks and still
reaches the survivor.

### `hibernate.mjs` — the one that actually matters

Takes ~3 minutes on purpose. Idle eviction is a **70–140s window**, so a fast
"open two tabs and edit" test proves broadcast and proves *nothing* about
hibernation.

It pushes, idles 170s untouched, then pushes and pulls again on the same
socket. When the object wakes, the constructor re-runs and every in-memory
field is gone — only `serializeAttachment` survives. The post-idle push is the
proof, because `owner_id` on that insert can only have come from
`deserializeAttachment()`. If that contract ever breaks, this is the only test
in the repo that will notice.

Pass `node scripts/sync-smoke/hibernate.mjs 200000` to idle longer.

## Cleanup

```bash
npx wrangler d1 execute faite-auth --local \
  --command "DELETE FROM session; DELETE FROM account; DELETE FROM user WHERE email = 'p4-smoke@example.com';"
```

The smoke rows live in that user's Durable Object and go away with it. Note
that deleting the D1 row directly does **not** invoke Better Auth's
`afterDelete` hook, so `wipe()` is not exercised this way.
