---
version: 1
slug: "src-components-board-todo-sheet-tsx"
primary_target: "src/components/board/todo-sheet.tsx"
related_targets: ["src/components/ui/sheet.tsx"]
---

# Surface: the to-do details drawer (the to-do sheet)

## Scope and mode

**Mode: Operate.** The right-edge sheet (a full-width right panel on phone) that opens
when a to-do's title is clicked: title, priority, when (date, time,
deadline), list, labels, location, reminders, repeat, description
(Markdown), sub-tasks, attachments, history, and the footer actions (Done,
Won't do, Back to <list>, Delete). File: `src/components/board/todo-sheet.tsx` and
the field components it composes; `src/components/ui/sheet.tsx`.

## Audience and job

Expanding an idea after capture — right away or later (PRODUCT.md
principle 5). Most opens are short: fix the date, add a note, finish it,
or let it go. A few are long: plan sub-tasks, attach, describe.

## Constraints for this surface

- `docs/DESIGN.md` §3 Overlays: real heading-weight title, hairline footer
  (never a filled bar), `rounded-3xl` outer, one `focus-ring`, sheets slide
  their own size with `--ease-out-soft` and never overshoot, exits shorter
  and unsprung.
- Terminology: "to-do", "Won't do", "Repeat", "Deadline" vs scheduled date
  (a deadline never moves a card). Sub-tasks are one level, real to-dos.
- Every control keyboard-reachable; shortcuts registered in
  `src/lib/shortcuts.ts`; triage chords match the card, palette and
  Overdrive (⌘↵ done, ⌘⌫ Won't do, ⇧⌘⌫ delete; bare ↑ done, ← Won't do,
  ↓ back to list, outside text fields).
- Phone: full-width right panel (not a bottom sheet), 44px targets, safe-area insets.
- No new color; status colors stay off board content; Delete is not a
  second red (EI-382 drift note).
- Must port to SwiftUI: tokens and named rules, not web-only tricks.

## Direction (implemented 2026-10-16, EI-396)

Shaped around quick edits and built per the brief in `.ai/ei-396-runbook.md`:

- Header: title, story line (rolled / Overflow / completion stamp, built from
  the row's helpers), priority select beside the title with a short
  `railBorder` mark. The hanging tab and full-height rail are gone. The
  "‹ Oct 16" button (aria-label "Return to Oct 16") returns to the day.
- Always visible: When (date, time or reminder, repeat) and Deadline, Repeat
  when recurring, List, Labels, Location, Sub-tasks, Notes.
- On demand: Attachments (N) and History, collapsed, not persisted.
- Footer: Done (primary ink, not green), Won't do, Back to <list> (only with
  a day; bare ↓), Delete (muted ghost icon, not red).
- Toasts clear the open drawer.

Rejected: a phone bottom sheet, "Schedule" as an ending, green Done, red
Delete, keeping the hanging tab. Decision record: docs/DESIGN.md §7,
2026-10-16.
