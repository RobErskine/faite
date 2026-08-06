# P4 / EI-49 — overnight progress log

Live status of the WebSocket-live-push work. **Updated after every phase**, so
a fresh agent (or Rob) can resume from here with zero context.

- Plan of record: `~/.claude/plans/i-would-like-to-majestic-backus.md`
- Branch: `rob/ei-49-websocket-live-push-with-hibernation` (not pushed)
- Linear: [EI-49](https://linear.app/rob-erskine/issue/EI-49/websocket-live-push-with-hibernation)

## How to resume

1. Read the plan of record above — it is self-contained.
2. Read the phase table below for where we stopped.
3. Read "Surprises worth keeping" before writing any code.

## Phase status

| Phase | What | State |
|---|---|---|
| 0 | `readFieldClocksBulk` param chunking + `wipe()` re-bootstrap | 🟡 in progress |
| 1 | `ws-protocol.ts`, `validate.ts`, `backoff.ts` (pure) | ⬜ not started |
| 2 | `/api/sync/ws` route + DO `fetch()` upgrade + handlers | ⬜ not started |
| 3 | `ws-transport.ts` + fallback routing + provider wiring | ⬜ not started |
| 4 | broadcast-on-write + `notifyRemoteChange` | ⬜ not started |
| 5 | interval tuning + docs | ⬜ not started |

## Verification bar (per phase, all must be green)

```bash
npm run typecheck                      # BOTH projects
npx vitest run
npm run build && npm run build:static  # phases touching client code
npx wrangler deploy --dry-run          # ONLY thing that bundles worker.ts
```

Known baseline: one pre-existing lint failure at
`src/components/board/use-day-track.ts:156` (`react-hooks/set-state-in-effect`).
Not ours. Don't fix.

## Log

- **Phase 0 started.** Branch cut from `main` (7 commits ahead of origin).
  `docs/SYNC.md` carried an uncommitted P4 plan section from the P3 session;
  it comes along on this branch and gets superseded in Phase 5.

## Surprises worth keeping

_(none yet)_

## Waiting on Rob

- Live two-browser test after Phase 4 — see the plan's Phase 4 test list.
