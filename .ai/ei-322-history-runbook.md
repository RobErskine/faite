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
- [ ] **EI-321** — close the gaps in the log
  - [ ] `service/todos.ts`: a status patch writes a status event
  - [ ] `updateTodo`: a date or list change writes `scheduled {from,to}` / `moved`
  - [ ] Overdrive payloads get `via: "overdrive"`
- [ ] **EI-322** — the History sheet
  - [ ] `src/lib/day-log.ts` and its tests
  - [ ] `useEventsBetween` hook, plus a `bulkGet` for titles
  - [ ] `history-sheet.tsx`, the `DateNav` trigger, the palette command, `?history=`, `computeModalOpen`
  - [ ] e2e: extend `activity-timeline.spec.ts`
  - [ ] Docs: ARCHITECTURE, design-system-runbook
- [ ] Verify: `npm test`, typecheck, `e2e:ci` (prod server on port 3100), full `npm run e2e`
- [ ] PR, CI green, squash merge, Linear learnings on all 3 tickets

## Findings

- EI-320 "Check this first": I did not test this on a real device. The code confirms the bug. `pull()` returns only rows with `version > cursor`, and the migration-21 `UPDATE` sets no version, so existing devices never see it. `useSettings` reads raw Dexie rows. `visible_event_kinds` had a server default of 4 kinds, but the Zod default is 6.
- EI-320 design: the conversion happens **when the value is read**, not with a backfill write. `hidden* === null` means "not converted yet". In that case, the hidden set is taken from the old visible array, measured against the newest *generation* of kinds that the array names. So a kind that was added after the user saved the filter can never count as hidden. There is no client backfill ledger (SCHEMA-CHANGES.md "Not built yet"), and this approach does not need one.
- `hidden*` is `z.array(z.string())`, not the enum. An older bundle must accept a kind that a newer bundle hid, for the same reason `todoEvent.kind` is a `z.string()`.
