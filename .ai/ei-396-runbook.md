# EI-396 — the to-do details drawer (runbook)

This file is the `## Handoff` comment on [EI-396](https://linear.app/rob-erskine/issue/EI-396), copied into the repo because the conductor session has no Linear MCP. It is the conductor's whole brief. If Linear is reachable, the comment and this file are identical.

## Handoff

Owner-confirmed brief (2026-10-16, `/impeccable shape`). Build it exactly; nothing here is open.

### Decisions
- **Shaped around quick edits.** Most opens are short (fix the date, add a note, finish it, let it go); long opens (sub-tasks, notes) still work.
- **Always visible, in this order:** title · story line · priority (header) · When (date · time/reminder · repeat, one control) · Deadline · List · Labels · Location · Sub-tasks · Notes.
- **On demand:** Attachments (with count) and History — two collapsed disclosure sections at the bottom, closed by default, not persisted.
- **Header story line** (quiet, muted ink at `text-xs`, ≥4.5:1): rolled → "Rolled from Oct 12 · Overflow in 2 days"; Overflow → "In Overflow since Oct 6 · 9 days" (`In Overflow ` + `formatOverflowAge`); done / Won't do → the card's completion stamp with its planned note ("Completed Oct 15, 12:05 PM · planned Oct 12"); plain → nothing. Built from the same helpers the row uses so they can't disagree.
- **Priority in the header**, beside the title, with a short rail mark matching the row (`railBorder`, `src/lib/priority.ts`). The hanging tab (`lg:-left-24`) and the full-height `PriorityRail inset-y-0` go.
- **Footer = the honest endings, keys matching Overdrive:** ↑ **Done** (primary ink button — NOT the green `success` variant; status colors stay off board content) · ← **Won't do** (outline) · ↓ **Back to <list name>** — shown **only when the to-do has a day**; removes the day and the reminder, keeps the list (Backlog when none — `NO_LIST_NAME`) · **Delete** (ghost icon, muted ink, NOT `text-destructive`; keeps its "Skip this occurrence" tooltip when recurring).
- Header navigation button "Back to Oct 16" (opened from a day) becomes visible "‹ Oct 16" with aria-label "Return to Oct 16" — two "Back to …" in one drawer would collide.
- While the drawer is open, toasts must not cover its footer.

**Rejected:** phone bottom sheet (stays a full-width right panel); "Schedule" as an ending (the When control already schedules); green Done; red Delete; keeping the hanging tab.

### Facts verified against origin/main
- `src/components/board/todo-sheet.tsx` (1,620 lines). `PriorityRail … inset-y-0` at ~692; nav button "Back to {formatShortDate(backToDay)}" ~698–709; priority `Select` id `todo-priority` with the tab div ~780–800 (`lg:absolute lg:top-4 lg:-left-24`); title `Textarea` ~861; body ~947: Date (`DatePopover`, holds day + time/reminder + Repeat entry) and Deadline (`DatePickerField`) two-up grid ~948–976; `RepeatSection` ~991 when recurring; `SheetRow`s List ~994, Labels ~1003, Location ~1007; Sub-tasks ~1019 (hidden for a sub-task); Notes `MarkdownField aria-label="Notes"` ~1030; Attachments ~1062; `HistorySection` ~1066 (already collapsible); footer `SheetFooter grid-cols-10` ~1099: Mark done (`variant="success"`) ~1103, Won't do ~1134, Delete ~1152.
- Keys in `handleSheetKeyDown` ~573–660: bare ↑ done, bare ← Won't do (outside text fields), ⌘↵ done, ⌘⌫ Won't do, ⇧⌘⌫ delete. Registered in `src/lib/shortcuts.ts` ~184–232 (scope "To-do sheet"); docs/KEYBOARD.md:56.
- The sheet receives `ctx?: PlacementContext` (~241). Helpers: `rollStateFor` (`src/lib/rollover-events.ts` ~151), `formatOverflowAge` (~115), `formatCompletionStamp` (`src/lib/event-time.ts` ~83); the card computes the planned note via `placeSettled` (`todo-card.tsx` ~233). Rolled tooltip text is built in `todo-row-parts.tsx`.
- "Back to list" action exists: `handleMoveBackToList` (`use-board-actions.ts` ~1804) → `moveTodoToList`, which clears `scheduledDate`, `scheduledAt`, `reminderTime` and keeps the list. `board.tsx` ~485 mounts `<TodoSheet>` with `onSetStatus={actions.handleSheetStatus}` (~501), `onDelete` (~503).
- `<Toaster />` from `src/components/ui/sonner.tsx` in `src/app/layout.tsx:191`, default bottom-right. Open sheet: `[data-slot="sheet-content"]:not([data-closed])`.
- e2e selectors that must keep working: `#todo-priority` + option `/^P1/` (core-flows.spec.ts:252); "Mark done" button (core-flows.spec.ts:120) — **rename it in the spec to "Done"**; "Delete" button name (core-flows:61, activity-timeline:76); `getByRole("list",{name:/^History for/})` (core-flows:104–107) — expand History first; attachments.spec.ts:44 `getByText("Attachments")` + "Attach a file" — expand first; `[aria-label="Notes"]` (link-preview.spec.ts:54); `support/sheet.ts` `openSheet`.
- Unit tests: `src/components/board/todo-sheet.test.tsx` (906 lines; footer describe ~406 is named "3-up row" — stale).

### Out of scope
Data model; existing chords; sheet motion; phone panel type; Attachments/History internals; the homepage demo; the row (EI-399 runs in parallel in another worktree).

## Steps
1. **Footer endings** — Done (primary ink, label "Done", hints ↑ / ⌘↵), Won't do (outline, ← / ⌘⌫), Back to <list name> (only when `todo.scheduledDate`; new prop `onMoveBackToList` wired in `board.tsx` to `actions.handleMoveBackToList`, then close), Delete (ghost icon, muted ink, ⇧⌘⌫). New bare **↓** key = Back to list, only outside text fields and only when the to-do has a day (mirror the existing bare ↑/← handling); register `LOCAL_SHORTCUTS` entry (scope "To-do sheet", source todo-sheet) and a row in KEYBOARD.md §1. Update the footer tests (rename the stale "3-up row" describe). — files: `src/components/board/todo-sheet.tsx`, `src/components/board/board.tsx`, `src/lib/shortcuts.ts`, `docs/KEYBOARD.md`, `src/components/board/todo-sheet.test.tsx`, `e2e/core-flows.spec.ts` (only the "Mark done" → "Done" selector) — verify: `npx vitest run src/components/board/todo-sheet.test.tsx src/lib/shortcuts.test.ts`
2. **Toasts clear the open drawer** — while a sheet is open, toasts render away from its footer: bottom-left at ≥640px, top-center below 640px, via a `:has([data-slot="sheet-content"]:not([data-closed]))` rule on sonner's `[data-sonner-toaster]` (or the Toaster's own props if cleaner). Add `src/lib/toaster-placement.test.ts` that reads `src/app/globals.css` and asserts the rule exists (pattern: `src/lib/fonts.test.ts`). — files: `src/app/globals.css`, `src/components/ui/sonner.tsx`, `src/lib/toaster-placement.test.ts` — verify: `npx vitest run src/lib/toaster-placement.test.ts`
3. **Header** — remove the full-height `PriorityRail` and the hanging `lg:-left-24` tab; priority `Select` (keep id `todo-priority`, options unchanged) sits in the header row beside the title with a short rail mark (`railBorder`); story line under the title (rules in Decisions; no line when `ctx` is absent except the completion stamp); nav button visible "‹ Oct 16", aria-label "Return to Oct 16". Tests for each story-line case, no hanging tab, priority select present. — files: `src/components/board/todo-sheet.tsx`, `src/components/board/todo-sheet.test.tsx` — verify: `npx vitest run src/components/board/todo-sheet.test.tsx`
4. **Body order and on-demand sections** — order: When+Deadline grid, `RepeatSection` (when recurring), List, Labels, Location, Sub-tasks, Notes; then two collapsed disclosure sections "Attachments (N)" and "History" (buttons with `aria-expanded`, closed by default; keep `HistorySection`'s own filter). The `DatePopover` trigger shows date · time · repeat (e.g. "Thu Oct 16 · 3:00 PM · Repeats weekly") when set. Update the two e2e specs to expand the sections first. — files: `src/components/board/todo-sheet.tsx`, `src/components/board/date-popover.tsx`, `src/components/board/date-popover.test.tsx`, `src/components/board/todo-sheet.test.tsx`, `e2e/attachments.spec.ts`, `e2e/core-flows.spec.ts` — verify: `npx vitest run src/components/board/todo-sheet.test.tsx src/components/board/date-popover.test.tsx`
5. **Docs** — docs/DESIGN.md §3 Overlays (the drawer's structure and endings) + one §7 row at the END of the table dated 2026-10-16; root `DESIGN.md` mirror (body only; keep frontmatter YAML valid); `.impeccable/surfaces/src-components-board-todo-sheet-tsx.md` (phone = full-width right panel; chords ⌘⌫ Won't do, ⇧⌘⌫ delete; Direction → implemented per this brief); `TODO-ITEM-DESIGN.md` if it describes the sheet. — files: `docs/DESIGN.md`, `DESIGN.md`, `.impeccable/surfaces/src-components-board-todo-sheet-tsx.md`, `TODO-ITEM-DESIGN.md` — verify: `npx vitest run src/lib/spelling.test.ts src/lib/ui-vocabulary.test.ts`

Parallel: 2 touches no file in common with 1, 3, 4 or 5 — run it alongside 1. 3 waits for 1; 4 waits for 3 (all share `todo-sheet.tsx`); 5 waits for 4.
Done when: the drawer shows the story line, priority in the header with no hanging tab, the always-visible fields in order, Attachments and History collapsed, and the footer Done · Won't do · Back to <list> (only with a day) · Delete with ↑ ← ↓ keys; toasts never cover the open footer; and `npm run e2e:ci` passes.

## Conductor report
(The conductor writes its `## Conductor report` here, below this line, and commits it with the PR, because it cannot post to Linear.)

## Conductor report

PR: https://github.com/RobErskine/faite/pull/164 (Linear ticket not moved: no Linear MCP in conductor sessions — move EI-396 to In Review by hand).

**Steps**
1. Footer endings — done. Needed one extra file outside the step list: `use-board-actions.ts` did not export `handleMoveBackToList` (typecheck caught it).
2. Toasts clear the drawer — done as CSS, then replaced after review (see below).
3. Header — done.
4. Body order and on-demand sections — done. The body order already matched. I deleted the EI-318 e2e test in `core-flows.spec.ts` (priority rail vs History day headers) because the rail no longer exists.
5. Docs — done.
No step was escalated to Opus.

**Checks (after the review fixes)**
typecheck, `npm test` (205 files, 3464 tests), openapi generate with no diff, lint, build:static, build, and `CI=1 e2e:ci` on port 3100 (151 passed) — all green. First gate run had 1 flaky, an Overdrive Quick sort test on phone-iphone that passed on retry. Skipped: the server suite (no auth/sync/API/MCP change). The rebase onto origin/main brought only a docs commit (#162), so §3 was not re-run for it. Toast placement was not checked in a browser.

**Review (pr-reviewer, posted on the PR)** — fixed in one round:
- bug: sheet "Back to <list>" / ↓ moved the whole multi-selection → new single-target `handleSheetMoveBackToList` + test.
- bug: CSS toast placement left toasts off-screen below 640px → `<Toaster position>` now chosen by `toasterPosition()`.
- bug: bottom-left toast covered the footer between 640 and ~1100px → top-center below 1100px.
- rule: "judgement" → "judgment" in a comment.
Left open: none. Not reviewed: `.impeccable/` notes and visual/contrast checks. Line 35 of this runbook still describes the old CSS toast approach and the 640px breakpoint (the code now uses 1100px).

## Round 2 — owner feedback on PR #164 (2026-10-16)

Owner reviewed the drawer at 1532×1029. Decisions below are settled; one question (a bare-arrow key for Delete) is open and NOT in these steps.

### Steps
6. **Header and footer polish** — (a) priority `Select`: remove the `pl-1.5` wrapper padding so the select sits flush left; keep the short rail mark (`railBorder`) but put it on the trigger itself, not on a padded wrapper. (b) The Close button (`absolute top-3 right-3`) overlaps the title field: reserve room for it in the header row (right padding on the header row, about the button's width + gap) so the title never runs under it. (c) Footer widths by weight: Done takes half the row; Won't do, Back to <list>, and Delete share the other half equally (each one sixth when Back to <list> shows, one quarter each when hidden). Delete stays a ghost icon with muted ink, just wider. Keep all labels, hints, keys, and tooltips. Update todo-sheet tests that assert the old footer or header classes. — files: `src/components/board/todo-sheet.tsx`, `src/components/board/todo-sheet.test.tsx` — verify: `npx vitest run src/components/board/todo-sheet.test.tsx` then `npm run typecheck`
7. **Body: fewer duplicates, even spacing, lighter defaults** — (a) Attachments: when the disclosure is open, `AttachmentsSection` renders its own "Attachments" label under the toggle — remove that inner label so only the disclosure button shows "Attachments (N)". Check other callers of `AttachmentsSection` first; if any needs the label, add a prop rather than removing it for all. (b) List, Labels, Location: make label-to-field spacing and the gaps between the three rows match the other fields in the body (When/Deadline use `space-y-1.5` label-to-field); one consistent rhythm, no per-row differences. (c) History opens by default when the to-do has more than 3 history events; otherwise closed. Still not persisted. (d) Sub-tasks: hide the "Add a sub-task" input by default. A "+" icon button (aria-label "Add a sub-task") sits beside the Sub-tasks label; clicking it shows the input and focuses it. After a commit the input stays open and focused for the next one; Escape, or a blur with an empty draft, hides it again. Existing commit-on-Enter-or-blur behavior unchanged. Update e2e specs that type into "Add a sub-task" to click the + first (grep `e2e/` for it). — files: `src/components/board/todo-sheet.tsx`, `src/components/board/todo-sheet.test.tsx`, `src/components/board/attachments-section.tsx` (path to confirm), `e2e/*.spec.ts` that use "Add a sub-task" or the Attachments label — verify: `npx vitest run src/components/board/todo-sheet.test.tsx` then `npm run typecheck`
8. **Deadline uses the Date control's quick picks** — the Date field's popover (`date-popover.tsx`) has a "Quick dates" group above the calendar (`role="group" aria-label="Quick dates"`, built from `DATE_POPOVER_KINDS` / `quickRescheduleDate`). Give the Deadline field the same quick-date group above its calendar. Reuse the existing pieces (extract the quick-dates group into a small shared component if that is the simplest way); no time/reminder or repeat in the Deadline popover. Keep `id="todo-deadline"`, the "No deadline" empty label and clearing. `DatePickerField` is also used by `repeat-dialog.tsx` — do not change that caller's look. — files: `src/components/board/date-popover.tsx`, `src/components/ui/date-picker-field.tsx` or a new `src/components/board/deadline-popover.tsx`, `src/components/board/todo-sheet.tsx` (only the Deadline field), their tests — verify: `npx vitest run src/components/board/date-popover.test.tsx src/components/board/todo-sheet.test.tsx` then `npm run typecheck`

Sequential: 6 → 7 → 8 (all touch `todo-sheet.tsx`). Then the full §3 gate, one commit, push to PR #164.
