# P4 / EI-49 — overnight progress log

**Status: complete. All six phases committed and verified, plus one self-review fix. Nothing in flight.**

The one thing left is yours: two real browsers on two machines.

- Plan of record: `~/.claude/plans/i-would-like-to-majestic-backus.md`
- Branch: `rob/ei-49-websocket-live-push-with-hibernation` — **7 commits, not pushed**
- Linear: [EI-49](https://linear.app/rob-erskine/issue/EI-49/websocket-live-push-with-hibernation) (still Todo — left for you to move)
- Full write-up: `docs/SYNC.md` → "P4 (EI-49) — WebSocket live push, shipped"
- Retrospective: `.ai/todo.md` → "Review — P4 (EI-49...)"
- New lessons: `.ai/lessons.md` → last three entries

## Phase status

| Phase | What | Commit | State |
|---|---|---|---|
| 0 | bound-param chunking + `wipe()` re-bootstrap | `528e33f` | ✅ |
| 1 | `ws-protocol.ts`, `validate.ts`, `backoff.ts` (pure) | `12c5ba3` | ✅ |
| 2 | `/api/sync/ws` + DO `fetch()` upgrade + handlers | `42a2998` | ✅ |
| 3 | `ws-transport.ts` + fallback routing + provider wiring | `80e8562` | ✅ |
| 4 | broadcast-on-write + `notifyRemoteChange` | `3cee615` | ✅ |
| 5 | adaptive interval + docs + smoke harnesses | `5e3451e` | ✅ |
| — | self-review fix: per-socket `openedAt` | `af48e25` | ✅ |

## Verification — all green

```
npm run typecheck               both projects, clean
npx vitest run                  504 passed (376 baseline + 128 new)
npm run build                   OK
npm run build:static            OK   (the P7 guard)
npx wrangler deploy --dry-run   OK   (only thing that bundles worker.ts)
npm run lint                    1 error — the known baseline at
                                use-day-track.ts:156. Not ours, not touched.
```

Plus, against a real Durable Object on an isolated `wrangler dev` (port 8790):

| Harness | Result |
|---|---|
| `scripts/sync-smoke/smoke.mjs` | **18/18** — handshake guards, round trips, hostile frames |
| `scripts/sync-smoke/broadcast.mjs` | **12/12** — three sockets, fan-out, origin exclusion, dead peer |
| `scripts/sync-smoke/hibernate.mjs` | **passed** — 170s idle, then push/pull on the same socket |

## What to look at first

1. **`docs/SYNC.md`'s new P4 section** — the whole story, including five
   places the pre-written plan turned out to be wrong and why.
2. **`src/server/sync/ws-server.ts`** — the `Origin` check. This is the one
   genuinely new security boundary. A WebSocket handshake bypasses CORS
   entirely, so nothing that protects `/api/sync/push` protects this.
3. **`src/components/sync/sync-provider.tsx`** — the wiring, and the only
   file where all the pieces are visible at once.
4. **`scripts/sync-smoke/README.md`** — how to re-run the live tests.

## Two things I'd flag

- **`wipe()` is still unverified end-to-end**, same blocker as P3: the
  `/delete-user` endpoint's CSRF Origin check rejects a non-`TRUSTED_ORIGINS`
  port. Phase 0 changed it (close sockets → delete → re-bootstrap), so it is
  now reasoned, reviewed, and *still* unexercised. Worth one disposable
  account against a branch preview.
- **`MAX_SOCKET_AGE_MS` is 1 hour**, chosen without usage data. It bounds but
  does not eliminate the window in which a socket outlives the session that
  authorised it — the HTTP path re-authenticates every request, a socket
  authenticates once. Blast radius is one user's own board, never
  cross-account.

## Your test

Sign in on two machines (or two browsers), then:

1. Edit on A → it should land on B in ~1s **without touching B**.
2. Open three tabs on A → the version check should keep them from storming.
3. DevTools → Network → Offline on B for 3 minutes, then Online → B should
   catch up **on reconnect**, not at the next interval tick.
4. Sign out on B → DevTools → Network → WS should show the frame closed.
5. Leave a tab idle >150s, then edit on the other device → still arrives.

If any of those misbehave, `.ai/todo.md`'s "Review — P4" lists what each
mechanism is and where it lives.

## Log

- Branch cut from `main` (7 ahead of origin). `docs/SYNC.md` carried an
  uncommitted P4 plan from the P3 session; it came along and was superseded
  in Phase 5.
- Phase 0 found two real latent bugs before any P4 code was written. The
  bound-parameter one would have fired on the first large catch-up pull.
- Phase 2 was driven entirely by a node harness before any client code
  existed — the client had nothing to debug against a server that hadn't
  been proven.
- Phase 5 converted the engine's `setInterval` to a self-rescheduling
  `setTimeout` so the cadence can actually change when a socket connects.
  Incidentally fixed a pre-existing quirk: a tab that drew a low jitter value
  kept that same offset for its entire lifetime.
- A self-review after the last commit caught a real bug in my own Phase 3
  code: `openedAt` was a field shared across reconnects and never reset, so a
  connection that never opened inherited the *previous* one's timestamp.
  `nextAttempt` then saw a long "open duration", reset the backoff ladder,
  and a server that was simply down would have been retried at the floor
  delay forever without ever reaching `shouldPause` — the exact hammering the
  backoff exists to prevent. Fixed by scoping it per-socket in the connect
  closure, which makes the whole class of bug unrepresentable rather than
  just fixing this instance. Committed as `fix(sync)` on top of Phase 5.
- No open GitHub issues or discussions on `RobErskine/faite` — nothing to
  cross-reference, fix, or close.
- Test account `p4-smoke@example.com` existed only in **local** D1 and is
  cleaned up. Production was never touched. No dev server left running.
