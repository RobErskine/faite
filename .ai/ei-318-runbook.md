# EI-318 — To-do sheet redesign

Ticket: https://linear.app/rob-erskine/issue/EI-318
Branch: `rob/ei-318-to-do-sheet-redesign-one-when-control-priority-in-the-header`

One branch, one PR. The full spec lives in the Linear ticket; this file is
the execution order and the running state.

## Order

- [x] 0. Recurrence anchor bug + regression tests (`use-board-actions.ts`)
- [x] 1. `parseDatePhrase` (quick-add) + `today`/`thisWeekend` preset kinds
- [x] 2. `DatePickerField` (ui) — Deadline + repeat-dialog "Ends on"
- [x] 3. `DatePopover` (board) — typeahead, presets, calendar, Time, Repeat
- [x] 4. Sheet header — priority beside title, monochrome ramp
- [x] 5. Field order — Tab field deleted, repeat summary line
- [x] 6. Footer weights + arrow verbs + shortcuts.ts + docs/KEYBOARD.md
- [x] 7. List combobox
- [x] 8. Attachment events + timeline alignment + docs
- [x] 9. typecheck -> test -> typecheck -> prod-build e2e -> full matrix -> PR

## Decisions (from the planning conversation)

1. A date pick on a recurring to-do moves **this occurrence only**.
2. **One** preset vocabulary — the card context menu gains Today + This weekend.
3. Time lives in the date popover **only**; Reminder stops being a field.
4. One branch, one PR.
5. Priority stays achromatic — monochrome opacity ramp, mirroring
   `PRIORITY_RAILS`. `docs/DESIGN.md` §7 decision A stands.
6. No autofocus on sheet open, so the arrow verbs are live immediately.
7. History adopts all four global-feed traits: newest-first, day headers,
   filter, time-only stamp.

## Running notes

### 0. Recurrence anchor (done)

Two bugs, one cause: an occurrence's id is frozen at the slot it was BORN in,
`scheduledDate` follows the card, and three places read the id when they meant
the position.

- New `occurrenceAnchor(todo)` in `lib/recurrence.ts` is now the single answer
  to "which day is this occurrence on". Identity stays the id.
- `recurrenceInfo` (`use-board-actions.ts`) — `onStop`, `onChangeRule` and
  `nextDate` all anchor on it. Dragging a card BACKWARD then hitting "Stop
  repeating" used to leave the slots it was dragged past still generating.
- `retargetSeries` (`repositories.ts`) — judges a child's survival on its
  effective date, so it no longer tombstones a card the new rule does produce.
- `expandRecurrences` (`recurrence-expand.ts`) — a second, pre-existing bug
  found on the way: slot occupancy was keyed by id only, so dragging an
  occurrence onto the day of the NEXT one produced two identical cards.
  Occupancy now follows `scheduledDate` for live children; settled ones still
  consume their original slot, because settlement is history.

Tests proven to fail against the old behavior before being made green:
`recurrence-expand.test.ts` (4 new), `repositories.test.ts` (2 new),
`recurrence.test.ts` (5 new, `occurrenceAnchor`).


### Follow-up needed (Linear MCP was down — NOT filed)

**`e2e/touch-smoke.spec.ts` "a horizontal swipe scrolls the day track" is
flaky on `phone-iphone`, and it is NOT from EI-318.** Reproduced on a clean
`main` tree: 3 consecutive runs gave flaky / pass / fail. The `toPass`
retry masks it most of the time, so it surfaces as an occasional red CI leg.

Likely the synthetic `swipe()` helper racing the pager's scroll-snap under
worker contention. Whoever picks it up: run it against a clean tree first,
several times, before assuming a feature branch caused it.

File this as its own ticket. It cost ~15 minutes of bisecting here.
