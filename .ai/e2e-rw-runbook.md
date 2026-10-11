# EI-354 — Real-world E2E (server-backed flows) — loop runbook

Loop state for the epic. Read this first on every wake-up. Committed with the
last ticket's PR (EI-361) as the record of how the epic ran.

## Rules for every ticket
- Branch = Linear `gitBranchName`, from fresh `origin/main` (needs the previous PR merged).
- Linear → In Progress at start; Done + learnings comment after merge.
- Specs go in `e2e/server/` (no `testMatch` needed). Use `e2e/support/server.ts`
  (`account` fixture, `signIn`, `freshAccount`). Accessible-name selectors only, no `data-testid`.
- Seed through UI/API only — never raw D1 writes (EI-68).
- Sync observation: poll `GET /api/sync/pull` via `page.request`, or a second
  `browser.newContext()` + `signIn` — never wait on `/api/sync/push` (WS path).
- Preview does not hot-reload: after editing `src/`, kill preview
  (`pkill -f "opennextjs-cloudflare preview"; pkill -f "wrangler dev"`) before `npm run e2e:server`.
- Before push: `npm run typecheck`, `npm test`, `npm run e2e:server`. `e2e:ci` only if `src/` UI changed.
- Merge = squash after CI green (Rob chose: merge each PR; each merge deploys to prod).
- Blocked → comment on ticket, mark here, next ticket.
- Commit/PR: Conventional Commit with ticket scope; no Co-Authored-By lines.

## Status
| Ticket | What | Status | PR |
|---|---|---|---|
| EI-355 | Harness on :8787 + EI-215 fix | merged 9a5e3fc, Done | #124 |
| EI-356 | Auth flows | merged 5b406b9, Done | #125 |
| EI-357 | Cross-client sync, offline queue | merged 8a64856, Done | #126 |
| EI-358 | API keys + REST round-trip | merged f0f9c00, Done, learnings posted | #127 |
| EI-359 | MCP adapter (EI-347 regression) | merged d4b7704, Done, learnings posted | #128 |
| EI-360 | CI gating | merged 0e37922 (Done via Closes) | #129 |
| EI-361 | (optional) Email ingest → Backlog | PR open; 13/13 locally | (this PR) |

## Notes / measurements
- Cold `npm run e2e:server`: 49s (warm .next/cache). Smoke ~7s/test.
- Existing gate locally: `npm run build && CI=1 E2E_PORT=3100 E2E_SERVER="npx next start -p 3100" npm run e2e:ci` → 142/142.
- EI-356: one unreproduced smoke flake (3 of 4 smoke repeats failed in the first
  `--repeat-each=4` run right after a preview start; output lost to `tail`).
  0 failures in 80 later runs incl. 4 cold restarts. Watch for it in EI-357.
  Always write full Playwright output to a file.
- Sign-out = Account menu (`/^Account/`) → menuitem "Log out" → wipes IndexedDB → `/`.
- EI-357: found EI-362 (first sheet opened offline → ChunkLoadError → board error page).
  Filed in Linear, related to EI-357. sync.spec.ts `loadSheetChunks` works around it.
- Conflict winner = later HLC at edit time; give each client its own setFixedTime.
- Mass failures with ERR_CONNECTION_REFUSED / socket hang up = preview restarted mid-run.
  Run long repeats detached (nohup script + done-file); a tool call was killed once (exit 144).

## Linear sync
- 2026-10-11 16:39: Linear back. EI-357 learnings posted; EI-358 + EI-354 → In Progress; epic progress comment posted.
- Note: "Closes EI-xxx" in a PR body makes the GitHub integration set Done on merge — only the learnings comment is manual.

## Wrangler upgrade + workers: 2 (resolved 2026-10-11 16:45)
- Made by this loop at 12:24/12:27 during a stress run, before a session restart.
- Rob chose: keep in this branch. Committed on the EI-358 branch as 453032e
  (`chore(EI-358): wrangler 4.149 and 2 workers for the server suite`); it ships with the EI-358 PR.
- Do not run two loops in this worktree: concurrent preview rebuilds broke each other's runs.

## Linear owed
- EI-360 learnings: posted by the other session (handoff message 2026-10-11).
- EI-361: set In Progress (Linear down when started).

## Remaining ticket scope (copied from Linear 2026-10-11, in case Linear drops again)
**EI-360 — CI gating.** Add server specs to `.github/workflows/ci.yml` following the e2e job (E2E.md §8.4):
Playwright container image tag = `@playwright/test` in package-lock, with the version-check step; explicit
timeouts (gate job / step / full run); `concurrency` + `cancel-in-progress` on PRs, `main` exempt; HTML report
uploaded on failure only. Decide placement (PR gate vs workflow_dispatch/scheduled) by billed-minutes
arithmetic (private repo, 2,000 min/month). MEASURE one run first (build + preview + migrations is slower
than `next start`), document choice + per-run cost in E2E.md §8. Acceptance: a real PR run shows the new
job/step green; E2E.md gains the cost-table row + placement rationale; PR-time cost within budget OR overage
called out explicitly for Rob to approve.
**EI-361 (optional) — Email ingest → Backlog.** Per docs/EMAIL-INGEST.md: submit a fixture email through the
ingest path (build it with postal-mime), assert the todo lands in Backlog, visible in the browser on the
server harness. Acceptance: green via e2e:server, OR close with a documented reason it can't be exercised
locally + what covers it instead. Respect EMAIL-INGEST.md trust model/privacy; no real personal data in fixtures.

## Process notes
- Stop a preview by killing the `wrangler … dev` parent, not only workerd (it respawns workerd).
  Never `pkill -f` a pattern that is also in your own command line (killed the shell, exit 144).
- zsh: never name a loop variable `path` (it is PATH). `${o:+-H "X: $o"}` is ONE word in zsh.
- EI-360 design: 3 steps in the existing e2e job (no new job). One `next build` with
  NEXT_PRIVATE_STANDALONE=true + NEXT_PRIVATE_OUTPUT_TRACE_ROOT feeds `next start` AND
  `opennextjs-cloudflare build --skipNextBuild` (6s). Local: gate 140 + 2 flaky (keyboard-drag,
  marketing scroll; passed on retry), server 11/11 in 61s.
- After #129 CI: get job duration (`gh run view <id> --json jobs`), compute billed delta vs the
  §8.4 table (gate 7 billed), write §8.6 + cost-table row. If PR cost rises > ~3 billed min,
  STOP and ask Rob (ticket: overage needs his approval).
- EI-361 plan (testable locally): sign up → Settings → "Email capture" → "Create my address" → read
  "Your capture address" (or POST /api/email/address via page.request) → POST raw RFC822 (needs
  Message-ID) to /cdn-cgi/handler/email?from=..&to=<local>@in.myfaite.app → 200; card in Backlog live,
  badge "From email · <from>". Unknown address → 400 "Worker rejected email…" (wrangler 4.149; the
  scripts/email-smoke README "200 does not mean accepted" is stale — fix it). postal-mime only PARSES;
  hand-write the MIME. Rate limit 50/h per address. Never log subject/body/sender/local part.
- 2026-10-11 14:58: session rob-ei-354-e2e-testing-28 STOPPED its loop: another session (-15 or -76) created + checked out the EI-361 branch in this worktree at 14:58:19. Only one loop may continue — EI-361 belongs to whichever session Rob keeps.
