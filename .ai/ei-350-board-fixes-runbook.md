# EI-350 — /board fixes loop (EI-374..EI-378), then re-critique

Owner decisions (2026-10-14): ship each fix as its own PR + squash merge (main
auto-deploys); Overflow first; eyebrow copy "Waiting for an ending"; quick-add
parses a date word mid-sentence but shows a dismissible chip; nothing off-limits.

Worktree: ~/jean/faite/rob_ei-350-… (one checkout, one branch per ticket from
fresh origin/main). Second critique runs against production after the last
deploy (~10–12 min after merge; check `wrangler deployments list`).

| # | Ticket | Branch | Status |
|---|---|---|---|
| 0 | EI-350 docs (PRODUCT/DESIGN/critique) | rob/ei-350-… | merged #139 |
| 1 | EI-374 Overflow honesty | rob/ei-374-overflow-tells-the-truth-quietly-real-age-per-card-red-only | merged #140 |
| 2 | EI-375 Quick-add feedback | rob/ei-375-quick-add-never-misfiles-silently-show-the-year-say-where-it | merged #141 (+EI-379 follow-up) |
| 3 | EI-376 Sign-up nudges | rob/ei-376-stop-nagging-to-sign-up-quiet-banner-that-stays-dismissed | merged #142 |
| 4 | EI-377 Won't do / to-do copy | rob/ei-377-say-wont-do-and-to-do-everywhere-remove-dropped-and-todo | merged #143 |
| 5 | EI-378 A11y floor | rob/ei-378-board-accessibility-floor-tab-count-contrast-add-field-focus | merged #144 |
| 6 | Re-critique /board on prod | — | 23/40 → 27/40; snapshot .impeccable/critique/2026-10-14T21-51-11Z… (uncommitted) |

Per ticket: branch from origin/main → implement (read
~/.claude/skills/impeccable/reference/craft-floor.md first) → narrow unit tests
+ `npm run typecheck` + `npm run lint` → commit `fix(EI-xxx): …` → push → PR →
CI green (verify + e2e) → squash merge → Linear Done + learnings comment.

## Batch 2 (owner decisions 2026-10-14: finished work shows on its completion day; all 5 new issues; Overflow stays grouped by list)

| # | Ticket | Status |
|---|---|---|
| 7 | EI-380 finished work on completion day (P1) | merged #145 |
| 8 | EI-381 names: skip links, Today region, title first, stray-comma regression | merged #146 |
| 9 | EI-382 small/thin red contrast, Hyperlegible 2xs, checkbox width | merged #147 |
| 10 | EI-379 quick-add leading date + second date word | merged #148 |
| 11 | EI-383 recall: 0 rolls, ↳ meaning, tab counts, ⚡, phone dots, ⌘K order, Overdrive toast | merged #149 |
| 12 | Third critique on prod | 27 → 29/40; snapshot uncommitted |

## Batch 3 (owner decisions 2026-10-14: all 5; wider Today column; Overflow badge age only)

| # | Ticket | Status |
|---|---|---|
| 13 | EI-384 wider Today (P1) | |
| 14 | EI-385 phone Lists peek (P1) | |
| 15 | EI-386 keyboard path gaps | |
| 16 | EI-387 dates: palette year/state, age-only badge, Won't do toast icon | |
| 17 | EI-388 phone touch targets 44px | |
| 18 | Fourth critique on prod | |
