# EI-253 — Overdrive on a single day column

Ticket: https://linear.app/rob-erskine/issue/EI-253/overdrive-on-a-single-day-column

## Decisions
1. Threshold reuses `settings.overdriveMinTodos` (default 5). No new setting/schema/migration.
2. Every day column past the threshold gets the bolt, not today only.
3. Header icon on both shells in v1. No phone-specific placement.

## The three real traps
1. **Ramp base.** Overflow ramps from today, offset 0 = today = a real move. A day session
   must ramp from ITS OWN day with floor `min=1` — offset 0 there is a no-op write. Plus a
   forward clamp: `ctx.today` re-ticks every 60s, so a stale session must never stage a past date.
2. **Open-only queue.** `placeSettled` can put done/dropped cards back on a day column
   (Overflow never gets settled cards). Day queue + bolt count must share ONE memo, filtered
   to `status === "open"`.
3. **One state.** `overdriveOpen: boolean` -> `overdriveSource: OverdriveSource | null`
   (`CivilDate | typeof OVERFLOW`).

## Order of work
1. `src/lib/overdrive.ts` + `src/lib/overdrive.test.ts` — green alone, all new params default
   to old behavior.
2. `use-board-ui-state.ts` + `board-guards.test.ts` + `use-board-ui-state.test.ts`
3. `use-board-data.ts` — `overdriveDayTodos` memo
4. `overdrive-button.tsx` (`DayOverdriveButton`) + test
5. `overdrive-overlay.tsx` + `board.tsx` + `overdrive-overlay.test.tsx` — ONE COMMIT
   (dropping `open` breaks board.tsx until rewired)
6. `desktop-board.tsx` + `phone-board.tsx`, then `board-column.test.tsx`
7. `e2e/overdrive.spec.ts` (extend existing file, no new file) + docs

## reduce() deltas (src/lib/overdrive.ts)
| case | before | after |
|---|---|---|
| `ramp` | `ramp===null?0:ramp+1` | `ramp===null?min:ramp+1` |
| `rampWeek` | `ramp===null?WEEK_STEP:ramp+WEEK_STEP` | `ramp===null?Math.max(WEEK_STEP,min):ramp+WEEK_STEP` |
| `wontDo` unstage | `ramp>0?ramp-1:null` | `ramp>min?ramp-1:null` |

Subtle bit: with `min=1`, `<-` at `ramp===1` must reach `null`, not `0` (0 resolves to the
source day = the no-op we're preventing, reachable via `-> <-`).

## Mandatory e2e fix
Tighten `e2e/overdrive.spec.ts` Overflow button locator to `/^overdrive ·/i` — the current
`/overdrive/i` regex will hit a strict-mode violation across all 8 existing tests once a day
column crosses the threshold and shows its own "Overdrive ..." button.

## Full spec
See Linear EI-253 description for the complete plan (files, tests, docs, out-of-scope items).

## Progress log
- [x] Step 1: lib/overdrive.ts — done, 57/57 unit tests pass, typecheck+lint clean
- [x] Step 2: use-board-ui-state.ts — done, board-guards + use-board-ui-state tests pass
- [x] Step 3: use-board-data.ts — overdriveDayTodos memo added, typecheck+lint clean
- [x] Step 4: overdrive-button.tsx — DayOverdriveButton added, 10/10 tests pass
- [x] Step 5: overdrive-overlay.tsx + board.tsx + overdrive-overlay.test.tsx — done, 56/56 tests pass
- [x] Step 6: desktop-board.tsx + phone-board.tsx + board-column.test.tsx — done, full typecheck+lint clean, 45/45 board-column tests pass
- [x] Step 7: e2e/overdrive.spec.ts (2 new tests, mandatory locator fix) + docs (OVERDRIVE.md, KEYBOARD.md, shortcuts.ts, COMMAND-PALETTE.md) — done. Full repo: typecheck clean, lint clean, 148/148 test files / 2282 tests pass. e2e NOT run live (sandbox blocks Chromium launch; auth preview build needs network for Google Fonts) — code typechecks+lints and matches the 8 passing existing patterns.
