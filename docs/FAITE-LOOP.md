# The Faite Loop

**The user-facing name for Faite's core mechanic:** a missed to-do rolls
forward onto today instead of rotting on a date that's already passed, and
after enough rolls it falls into **Overflow** — put off that long, it
probably wasn't important. This doc is the canonical reference for how the
loop is configured, computed, and made visible. Ticket: EI-96.

The engine (`deriveColumn()`, EI-38, P1) predates this doc and was always
correct; EI-96 made its length configurable and its effects visible. If you
only need the placement rule itself, `lib/scheduling.ts`'s header comment and
`docs/ARCHITECTURE.md` §2.2/§5 are shorter. Read this doc when touching the
Settings section, the card affordances, or either timeline's rollover rows.

---

## 1. The rule

```
rolls <= 0                 -> its scheduled day
rolls <= overflowAfterDays -> today
otherwise                  -> Overflow
```

`deriveColumn()` (`lib/scheduling.ts`) computes this **on every render** from
`todo.scheduledDate` plus the clock — no cron, no nightly mutation, no write
of any kind. See ARCHITECTURE.md §2.2 for why: a stored/mutated rollover
needs a cron (breaks offline), destroys the user's original intent, corrupts
recurrence, and can't be undone. Deriving it means every device — including
one that was asleep for a week — independently arrives at the same answer
the moment it wakes up.

`rollsElapsed()` counts **eligible days**, not calendar days: with
`workdaysOnly` on, a Friday miss viewed on Monday has rolled once, not
three. The scheduled day itself is zero rolls — being due today isn't a
roll.

## 2. Configuring the loop

`settings.overflowAfterDays` (`lib/schema.ts`) — `int, 0–30, default 3`.

- **0** — a miss falls straight into Overflow the next eligible day. No
  gradual rolling.
- **30** — the maximum. There is deliberately **no "never overflow" option**:
  the whole thesis of the mechanic is that everything eventually gets a
  verdict.
- `workdaysOnly` (+ `workdays`, default Mon–Fri) — rollover targets skip
  non-working days. This affects **rollover targets only**: a todo the user
  explicitly scheduled on a Saturday still shows on Saturday regardless.

Both live in **Settings → Faite Loop**
(`src/components/settings/loop-section.tsx`, second in the nav — right after
Profile, and sharing the card's `CornerDownRight` rollover icon), added by
EI-96 — previously `overflowAfterDays` was reachable only via its DB
default, and `workdaysOnly` only via the ⌘K palette (`"Roll over on
workdays only ⇄ every day"`, still there — it writes the same setting).

The section renders a **live worked example** as three boxes
(`loop-example.tsx`'s `LoopExampleCards`) — the same fake to-do ("Renew
passport") shown at each moment the loop can put it in: **Scheduled** →
**Rolled over** (omitted entirely when `overflowAfterDays` is 0 — nothing
to show) → **Overflow**. Each box renders the **real** `TitleMarkers`/
`TodoMetaBadges` (`todo-row-parts.tsx`), fed real `rollEventsFor()` output
for the fake todo — not a lookalike — so hovering the glyph or badge pops
the exact same tooltip a real card would, and the example can never drift
out of sync with what the board actually renders. `loopExample()` supplies
the dates and `describeLoop()` — still the single sentence-builder, kept as
an `sr-only` summary for screen readers — both read from the same
primitive, so they can't disagree. This replaced a plain-text sentence:

> Miss Aug 12 → rolls to Aug 13, Aug 14, Aug 15 → Overflow on Aug 16

which is now the sr-only fallback rather than the sighted UI, but the goal
is the same: the off-by-one (does "3 rolls" mean 3 days on the board, or 3
days plus the original?) is demonstrated rather than left to the setting's
label to explain. Both settings sync (`SETTINGS_SYNCED_FIELDS`,
`lib/sync/wire.ts`) and needed **no schema migration** — the server column
and sync allowlist already existed; only the Zod range (`.min(0).max(30)`,
previously `.min(1)`) and the UI were new.

## 3. Recurring to-dos bypass the loop entirely

An overdue recurring occurrence goes **straight** to Overflow — no grace
period, no gradual rolling (`recurrence-expand.ts`'s `forceOverflow`,
`isOverdue = liveDate < ctx.today`). Rationale: the series comes back around
on its own schedule, so there's nothing for the loop to gradually escalate —
"put off that long" doesn't apply when a fresh occurrence is coming anyway.

`rollEventsFor()` (below) returns `[]` for any todo with a
`recurrenceParentId`, so every visible trace of the loop — the card marker,
the Overflow badge, both timelines' rollover rows — is silent for recurring
items. They still get the destructive `×N` "missed occurrences" badge
(`todo-row-parts.tsx`), which is the recurring-specific equivalent signal.

## 4. Making it visible: `rollEventsFor()`

`src/lib/rollover-events.ts` is the single derivation every visible
affordance reads from — written once, consumed three places, so the rule
can't drift between the card, the day timeline, and the todo History.

```ts
type RollEvent =
  | { kind: "rolledOver"; day: CivilDate; from: CivilDate; rolls: number; overflowsIn: number }
  | { kind: "overflowed"; day: CivilDate; from: CivilDate; rolls: number; overflowsIn: number };

rollEventsFor(todo, ctx): RollEvent[]
```

For a todo scheduled on `S`, viewed at `ctx.today`, this returns one
`rolledOver` entry for each eligible day it rolled onto (up to
`overflowAfterDays` of them), then one `overflowed` entry for the day it
crossed the threshold — and nothing after that; once in Overflow there's no
new placement to report on subsequent days. Returns `[]` immediately for a
settled todo (`status !== "open"`), a recurring occurrence
(`recurrenceParentId` set, §3), an unscheduled todo, or one not yet
due/rolled (`rolls <= 0`).

The loop that builds the sequence is bounded by `overflowAfterDays + 1`
(≤ 31 iterations) **regardless of how old the todo is** — a to-do missed a
year ago costs the same as one missed yesterday, because the function stops
the moment it reaches `overflowed`.

`loopExample(ctx)` and `describeLoop(ctx)` build the Settings worked example
(the three boxes and its sr-only sentence, respectively) from the same
primitive (`rolloverTarget`) — the demonstration and the real placement
logic can't disagree because they're built from the same piece.

## 5. Where it renders

### The card (`todo-card.tsx`, `todo-row-parts.tsx`)

`TodoCard` already receives `ctx: PlacementContext` for its own placement
needs, so both affordances below cost one `rollEventsFor(todo, ctx)` call and
no new prop plumbing through `board-column.tsx` or `use-board-data.ts`.

- **Rollover marker** — a quiet `CornerDownRight` glyph in `TitleMarkers`,
  alongside the deadline/location/recurrence markers, shown only while still
  rolling (`rolls > 0`, not yet in Overflow). Two-line tooltip: "Rolled from
  Aug 12 - 3 days" / "Overflow in 2 days" — pairing how long it's rolled with
  when it will fall into Overflow, the two questions the marker exists to
  answer. `overflowsIn` (`RollEvent`, `rollover-events.ts`) counts down in
  the same eligible-day units as `rolls`, computed from `rolls` and
  `overflowAfterDays` alone, so it's known — and shown — from the very first
  roll, not just once the todo is close to the threshold.
  `TooltipContent`'s popup is `inline-flex` (row direction, `ui/tooltip.tsx`),
  so two direct `<span>` children sit side by side rather than stack —
  actual multi-line content needs one wrapping `flex flex-col` span as the
  single flex item, which stacks its own children as a column.
- **Overflow age badge** — a loud destructive badge in `TodoMetaBadges`,
  shown only once in Overflow: "In Overflow N days". `N` counts **eligible
  days since the original scheduled date** (`rollsElapsed`'s count) — the
  same clock that placed it there, not days since it entered Overflow.
  Tooltip: "Scheduled Aug 12 · in Overflow since Aug 16".

These are mutually exclusive states of the same sequence — a card never
shows both, and shows neither for a settled or recurring todo.

### The day timeline (`day-timeline.ts`, `day-sheet.tsx` — EI-87)

Two new `DayEventKind`s, both derived (no event rows, no writes), merged
into `buildDayTimeline`'s existing per-day derivation via the board's
`PlacementContext`:

- `rolledOver` — "Rolled over" — emitted on each day a still-rolling todo
  lands there.
- `overflowed` — "Fell into Overflow" — emitted once, the day it crossed
  the threshold. This is the row that answers "how did this end up in
  Overflow?" — the whole reason rollover needed a timeline presence at all.

Both are synthetic instants (`zonedInstant(day, "00:00", timezone)`, since a
roll isn't a write and has no real timestamp) and both are in the day
sheet's filter menu and `settings.visibleEventKinds`' default.

### The per-todo History (`todo-timeline.ts`, `todo-sheet.tsx` — EI-94)

Same two kinds, merged into `buildTodoTimeline`'s real event-log output.
**A consecutive run of `rolledOver` days collapses into ONE row** — "Rolled
over · 5 days, from Aug 12" — rather than one row per day, so a to-do that
sat in Overflow for weeks doesn't drown its real edit/move/complete history
in identical-looking rows. `overflowed` stays its own row. `ctx` is
**optional** on `buildTodoTimeline`/`TodoSheet`/`HistorySection` — omitted
(as in a test with nothing to show), History renders exactly as it did
before EI-96, no roll rows at all.

`HistorySection` opens **by default** — a todo's history, roll rows
included, is usually exactly what someone opening the sheet wants to see,
so it no longer costs an extra click.

## 6. The documented trade: derived history can be rewritten

Because every roll row is recomputed from the **current** `scheduledDate` on
every render, rescheduling a todo rewrites which days it appears to have
rolled through. Reschedule a todo that overflowed last week to next Tuesday,
and its history no longer shows the old overflow — the new `scheduledDate`
produces a different (or empty) roll sequence. This is the same trade
`day-timeline.ts` already documents for its `scheduled` ("Assigned here")
event, and follows from the same "derived, never stored" decision (§1) that
makes the Faite Loop itself correct and cron-free. See ARCHITECTURE.md §2.14
("Derive unless the fact is historical") for why this is the right trade
here, in contrast with `todoEvent` (EI-94), which persists specifically
*because* its facts must survive exactly this kind of later change.

## 7. Key files

| File | Role |
|---|---|
| `lib/scheduling.ts` | `deriveColumn()`, `rollsElapsed()`, `rolloverTarget()`, `isEligible()` — the placement rule itself |
| `lib/schema.ts` | `overflowAfterDays`, `workdaysOnly`, `workdays` on `settingsSchema`; `rolledOver`/`overflowed` in `dayEventKindSchema` |
| `lib/rollover-events.ts` | `rollEventsFor()`, `loopExample()`, `describeLoop()` — the one derivation everything else reads |
| `components/settings/loop-section.tsx`, `loop-rolls-field.tsx`, `loop-example.tsx` | Settings → Faite Loop |
| `components/board/todo-row-parts.tsx`, `todo-card.tsx` | rollover marker + Overflow age badge |
| `lib/day-timeline.ts`, `components/board/day-sheet.tsx` | day timeline rollover rows |
| `lib/todo-timeline.ts`, `components/board/todo-sheet.tsx` | per-todo History rollover rows |
| `lib/recurrence-expand.ts` | the recurring bypass (§3) |

Tests: `scheduling.test.ts`, `rollover-events.test.ts`, `settings-sheet.test.tsx`
(Faite Loop section), `todo-card.test.tsx` ("the Faite Loop" block),
`day-timeline.test.ts` ("the Faite Loop" block), `todo-timeline.test.ts`
("the Faite Loop (EI-96)" block), `todo-sheet.test.tsx` ("History — the
Faite Loop" block).
