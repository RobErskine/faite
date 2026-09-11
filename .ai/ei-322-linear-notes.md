# Linear notes to post (the MCP dropped out mid-session)

The Linear MCP server disconnected after the tickets went to In Review, and
there is no `LINEAR_API_KEY` in the environment, so these were never posted.
Paste each block as a comment on its ticket and move the ticket to **Done**.
PR: https://github.com/RobErskine/faite/pull/111 (squashed as `d206d65`).

---

## EI-320

**Done** in #111, commit `7ab01d6`.

The ticket's "Check this first" step was never run on a real device. I
confirmed it from the code instead, which is enough for this one: `pull()`
returns only rows with `version > cursor`, and a migration's `UPDATE`
allocates no version, so migration 21 cannot reach a device that already holds
the settings row. `useSettings` reads raw Dexie with no Zod, so nothing
repairs it on the way in either.

**The fix is not the one the ticket proposed, and the difference matters.**
The ticket said: convert on the client through `mutate()`. That conversion is
`ALL - visible`, and it would have written the bug in permanently — every kind
the user never saw would have been recorded as one they had switched off.
What shipped converts **when the value is read**, measured against the newest
*generation* of kinds the saved array actually names (`lib/kind-filter.ts`):
an array naming `rolledOver` came from a build that offered `overflowed`
beside it, so leaving that out was a choice; an array naming neither predates
both, so neither counts as hidden. `hidden* = null` means "not converted yet".
No backfill write, no client ledger (which `SCHEMA-CHANGES.md` still lists as
"Not built yet"), works signed out.

`hidden*` is `z.array(z.string())`, not the kind enums — an older bundle has
to parse a kind a newer one hid, the same reason `todoEvent.kind` is a string.

Recorded in `.ai/lessons.md` as "A preference that lists what is SHOWN cannot
learn a new value", and in `docs/SCHEMA-CHANGES.md` as the shape to reach for
next time.

---

## EI-321

**Done** in #111, commit `63c0600`. All three parts shipped as described.

The part the ticket did not predict: **every update route asked
`durableHlcQueue` for exactly 2 stamps.** One update can now push four entries
(todo + `edited` + status + `scheduled`), and that queue throws when it runs
out — so the first API patch touching three logged fields would have been a
500 in production, not a build error. The size is now the exported
`UPDATE_TODO_MAX_ENTRIES`, and `routes.test.ts` has a patch that uses all four
and fails without it.

One deliberate asymmetry, documented in `docs/API.md`: on the server a
`listId` change still logs as `edited`. A `moved` row carries both list
*names*, and the service builder has no store to read them from. The client
logs `moved`.

---

## EI-322

**Done** in #111, commit `d12d677`.

Built as agreed: the board stays forward-only, History is a separate sheet
behind a button left of the date range, reading only the real log.

Worth knowing:

- **Two indexed range scans and one `bulkGet`.** `useTodoTitles()` — what the
  activity feed uses — reads every to-do row. For a per-day view that is the
  wrong shape, so History resolves titles with `db.todos.bulkGet` over just
  that day's ids.
- **`modifiersClassNames` lands on the day CELL**, which is already
  `relative`, while the day button inside it is `z-10`. The dot is an
  `::after` at `z-20`, recolored on `data-selected` so it survives the
  selected day's fill.
- **A callback prop loses TypeScript's narrowing of `data.ctx`** in
  `board.tsx`, even past the ready gate. Read `today` into a const.
- **Quick-add ate my e2e title.** "Look back at the day" became a to-do called
  "Look back at the" with an End-of-day reminder, because `day` is a date
  word. Use a title with no date words when an e2e quick-adds.
- **A local-only e2e failure, worth not re-deriving:** `touch-smoke`'s
  horizontal swipe fails on every phone project on this machine, and **also
  fails on a clean `main` build here**. CI is green for it on `main` and on
  #111. Do not chase it on a branch.

Follow-ups, deliberately not built: a "Back to History" affordance on a to-do
opened from History (the sheets swap today, same as the day sheet), and
merging Activity and History into one sheet with tabs.
