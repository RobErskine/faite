---
version: 1
slug: "src-components-board-todo-sheet-tsx"
primary_target: "src/components/board/todo-sheet.tsx"
related_targets: ["src/components/ui/sheet.tsx"]
---

# Surface: the to-do details drawer (the to-do sheet)

## Scope and mode

**Mode: Operate.** The right-edge sheet (bottom sheet on phone) that opens
when a to-do's title is clicked: title, priority, when (date, time,
deadline), list, labels, location, reminders, repeat, description
(Markdown), sub-tasks, attachments, history, and the footer actions (Mark
done, Won't do, Delete). File: `src/components/board/todo-sheet.tsx` and
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
  Overdrive (⌘↵ done, ⇧⌘⌫ Won't do, ⌘⌫ delete).
- Phone: bottom sheet, 44px targets, safe-area insets.
- No new color; status colors stay off board content; Delete is not a
  second red (EI-382 drift note).
- Must port to SwiftUI: tokens and named rules, not web-only tricks.

## Direction (owner decision 2026-10-15)

**Rethink the layout before polishing** (`/impeccable shape`). Known
problems from four critiques: ten fields open at once; the priority tab
hangs outside the sheet's left edge and reads as a rendering glitch; the
dashed/dotted edge runs the full height for P3/P4; toasts cover the footer.

## Unresolved

- Which fields are always visible vs on demand.
- Where priority lives.
- Whether history belongs in the sheet or behind a link.
