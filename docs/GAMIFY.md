# Goals & streaks — parked

**Status: on ice since 2026-10-11.** Nothing was built. Ticket:
[EI-363](https://linear.app/rob-erskine/issue/EI-363/goals-and-streaks-gamification-parked)
(Backlog). The product rule today is unchanged: no streaks, counters, or
progress gamification (`docs/DESIGN.md` §4, `docs/RESEARCH.md` §2.9 and §4,
and the homepage beat "Miss one. There is no streak to break." in
`src/lib/story-beats.ts`).

This file records the thinking so far, so a later session can pick it up
without doing it again — or can decide, quickly, not to.

## 1. Why it is parked

The plan was finished and every design question had an answer. On reflection,
the open question is not *how* but *whether*: it is not clear Faite needs
gamification at all. The blocker was always the product, not the code — the
feature contradicts a claim the homepage makes to every visitor.

## 2. What was proposed

An **opt-in** goals & streaks system, **off by default**.

- **Goals.** The user sets a daily and a weekly completion goal.
- **Soft streak.** One missed day (or week) is forgiven; two misses in a row
  reset the streak. A missed day adds nothing. The panel says "Missed
  yesterday — meet today to keep it." This follows Lally et al. (2010), already
  cited on the homepage: missing one opportunity did not materially affect
  habit formation.
- **What counts.** `done` only, sub-tasks included — exactly what History
  shows under Done. Won't do does not count.
- **Days off.** A "skip days off" setting, on by default, reusing the existing
  `workdays` setting (Mon–Fri default; Sun–Thu works too). A skipped day
  neither breaks nor extends a streak. Work done on a day off still counts
  toward the weekly goal.
- **Week start.** A new `weekStartsOn` setting, Monday by default.
- **UI.** Black-and-white radial rings: a daily ring in today's column header,
  a weekly ring in the app header (desktop and phone). Clicking opens a panel:
  "3 of 5 today · 6-day streak" plus the weekly numbers. The rings are black
  and white because the color grammar (`docs/DESIGN.md`) keeps status colors
  off the board.
- **Celebration.** A toast when a goal is met; confetti only with GOOD JOB
  mode on.
- **Phase 2: achievements**, e.g. `early-bird` for finishing a to-do before
  6am. Phase 1 blocks Phase 2.
- **Homepage copy** would have changed to "Miss one. There is no *hard* streak
  to break." so the promise stays true in the product.

## 3. Design decisions, and why

| Decision | Why |
|---|---|
| Opt-in, off by default — not a full reversal of the no-streaks stance | The smallest product change that could be defended against `RESEARCH.md`. |
| **Goal history**, not one current goal: `goals` is a list of `{ since, daily, weekly, skipDaysOff }`; each past day is judged against the goal in effect that day | Raising a goal from 5 to 10 must not break a streak earned under 5. |
| **Streaks are calculated on the client, never stored** | Every device already has the full history in the append-only `todoEvents` log, so no server work. `ARCHITECTURE.md` §2.14: derive unless the fact is historical. |
| **Achievements are stored**, as a new synced kind `achievement` whose ID is the achievement key (`early-bird`) | An earned badge is a historical fact: reopening a to-do or changing time zone must not take it away. Key-as-ID means two devices that award the same badge merge into one record. |
| Count from **`todoEvents`**, never `completedAt` | `completedAt` is overwritten when a to-do is finished again and cleared when it is reopened. |
| Reuse the "last status change of the day wins" rule from `activeDays()` in `src/lib/day-log.ts` | The counting logic nearly exists; extract it into a shared helper instead of writing a second one. |
| Settings migration `settings-add-goals` adding `goals` (JSON, `null` = off) and `weekStartsOn` | The plan said ledger id 24; `src/server/db/migrations.ts` is already past 25, so take the next free id. See `docs/SCHEMA-CHANGES.md`. |

## 4. The evidence

The full sources are in `docs/RESEARCH.md` §2.9 and §4. In short:

- **Against:** Deci, Koestner & Ryan (1999) — completion- and
  engagement-contingent rewards undermine intrinsic motivation.
- **Pushback:** Cameron et al. (2001) and Cerasoli et al. (2014). The claim
  both camps accept is narrow: harm comes from rewards that are *tangible,
  expected, and loosely tied to performance*. A classic streak counter —
  contingent on nothing but showing up — fits that exactly.
- **Where this proposal sat:** a goal the user chose, opt-in, earned by output
  (finished to-dos), with a forgiving streak, is on the safer side of that
  line. Defensible, but only if documented.
- **For:** Kivetz, Urminsky & Zheng (2006), the goal-gradient effect, is the
  strongest published argument for progress gamification.
- **Lally et al. (2010):** one miss does not matter — the reason the streak
  was soft.

## 5. Arguments against building it

- **It weakens a public promise.** "There is no streak to break" is a homepage
  beat. Adding "hard" keeps it technically true, but softens one of the
  product's clearest positions.
- **It is not the core loop.** Faite's mechanic is rollover to today, then
  Overflow (`docs/FAITE-LOOP.md`). A score is a second, competing reason to
  open the app.
- **The code already says no.** `activeDays()` in `src/lib/day-log.ts` shows
  presence only, because "a count would be a score". History's per-list counts
  are a narrow, deliberate exception (`docs/DESIGN.md` §7, 2026-09-11).
- **Cost on every board.** New settings, a migration, two rings in permanent
  headers, and a panel — UI that every user pays for in attention, even with
  the feature off.
- **The evidence is contested.** Neither side of §4 makes the feature a clear
  win; the best case is "not harmful if done carefully".

## 6. If we come back to it

**Questions to answer first**

1. Does Faite want a score at all? If yes, write the decision into
   `docs/DESIGN.md` §7 before any code.
2. Is a lighter version enough — for example, only the Overdrive-style tally,
   or a goal with no streak?
3. Is the homepage copy change acceptable, or does the feature need to stay
   invisible to the marketing story?

**Files it touches**

| File | Change |
|---|---|
| `docs/DESIGN.md` §4, §7 | Replace the no-streaks rule with the opt-in exception; add a decisions-log row. |
| `docs/RESEARCH.md` §2.9, §4 | Update the "why there are no streaks" framing. |
| `src/lib/story-beats.ts` | Headline → "Miss one. There is no *hard* streak to break." plus body copy (`docs/HOMEPAGE.md` first). |
| `src/lib/day-log.ts` | Extract the last-change-of-the-day rule from `activeDays()`. |
| `src/lib/goals.ts` (new) + tests | Per-day counts, daily and weekly soft streaks; tests mirror `day-log.test.ts`. |
| `src/server/db/migrations.ts` | `settings-add-goals`. |
| Settings | A "Goals" section. |
| Board header, today's column header | The two rings and the panel. |
| `docs/GOALS.md` (new) | Replaces this file as the doc of record. |
