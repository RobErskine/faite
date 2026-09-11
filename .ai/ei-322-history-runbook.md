# EI-320 → EI-321 → EI-322 runbook

The plan and its decisions are in the `## Handoff` comment on
[EI-322](https://linear.app/rob-erskine/issue/EI-322). Here we track only progress and findings.

One branch, one PR `feat(EI-320/EI-321/EI-322): …`, squash merge. One commit per ticket.

## Progress

- [x] **EI-320** — the filters store the kinds that are hidden, not the kinds that are shown
  - [x] Zod `hidden{Event,Activity,History}Kinds: string[] | null`, plus Drizzle columns and migration 23. Also `columns.ts` JSON and `wire.ts` synced fields
  - [x] `src/lib/kind-filter.ts`, which converts the old `visible*` arrays when they are read (no backfill write)
  - [x] Change the three filter UIs: `activity-sheet.tsx`, `day-sheet.tsx`, `todo-sheet.tsx` HistorySection
  - [x] Tests, `schema:generate`, `schema:check`, `openapi:generate`, docs
- [x] **EI-321** — close the gaps in the log
  - [x] `service/todos.ts`: a status patch writes a status event
  - [x] `updateTodo`: a date or list change writes `scheduled {from,to}` / `moved`
  - [x] Overdrive payloads get `via: "overdrive"`
- [x] **EI-322** — the History sheet
  - [x] `src/lib/day-log.ts` and its tests
  - [x] `useEventsBetween` hook, plus a `bulkGet` for titles
  - [x] `history-sheet.tsx`, the `DateNav` trigger, the palette command, `?history=`, `computeModalOpen`
  - [x] e2e: extend `activity-timeline.spec.ts`
  - [x] Docs: ARCHITECTURE, design-system-runbook
- [ ] Verify: `npm test`, typecheck, `e2e:ci` (prod server on port 3100), full `npm run e2e`
- [ ] PR, CI green, squash merge, Linear learnings on all 3 tickets

## Findings

- EI-320 "Check this first": I did not test this on a real device. The code confirms the bug. `pull()` returns only rows with `version > cursor`, and the migration-21 `UPDATE` sets no version, so existing devices never see it. `useSettings` reads raw Dexie rows. `visible_event_kinds` had a server default of 4 kinds, but the Zod default is 6.
- EI-320 design: the conversion happens **when the value is read**, not with a backfill write. `hidden* === null` means "not converted yet". In that case, the hidden set is taken from the old visible array, measured against the newest *generation* of kinds that the array names. So a kind that was added after the user saved the filter can never count as hidden. There is no client backfill ledger (SCHEMA-CHANGES.md "Not built yet"), and this approach does not need one.
- `hidden*` is `z.array(z.string())`, not the enum. An older bundle must accept a kind that a newer bundle hid, for the same reason `todoEvent.kind` is a `z.string()`.
- EI-321: every server update route requested exactly 2 HLC stamps (`durableHlcQueue(stub, 2)`). One update can now push 4 entries (todo + edited + status + scheduled), and the queue throws when it runs out. So the size is now the exported `UPDATE_TODO_MAX_ENTRIES`, and a route test covers a patch that uses all 4.
- EI-321: on the server, a list change stays `edited`, because a `moved` row carries both list names and the service builder has no store. The client logs `moved`.
- EI-322: my first e2e title, "Look back at the day", became the to-do "Look back at the" with an End-of-day reminder, because quick-add reads "day" as a date word. Use a title with no date words in an e2e quick-add.
- EI-322: a callback prop loses TypeScript's narrowing of `data.ctx` in `board.tsx`, even past the ready gate. Read `today` into a const right after the gate.
- EI-322: `modifiersClassNames` on the shared `Calendar` applies to the day cell (`td`, already `relative`), and the day button is `z-10`. So the dot is an `::after` with `z-20`. The cell has `data-selected`, so the dot can switch color on the selected day.
- Visual check (production build on port 3100, dark theme, 1440×900 and iPhone 13): the button sits left of the range in both shells, the sheet is full width on the phone, and the empty day reads cleanly. I made the calendar background transparent after seeing it as a dark box inside the sheet.
- Local e2e: `touch-smoke` "a horizontal swipe scrolls the day track" fails on phone-iphone, phone-pixel and phone-iphone-landscape on this machine (scrollLeft does not change). It **also fails on a clean `main` build here** (97a1346, checked out detached and rebuilt). CI on `main` is green for the same test, so it is local and was there before this branch. Local gate: 137 passed, 1 failed (this test). Full matrix: 184 passed, 3 failed (this test, 3 projects), 1 skipped.
