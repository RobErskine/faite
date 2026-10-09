---
version: 1
slug: "src-app-board-page-tsx"
primary_target: "src/app/board/page.tsx"
related_targets: ["src/components/board/board.tsx"]
---

# Surface: the board (`/board`)

## Scope and mode

**Mode: Operate.** The visitor completes a task: capture, commit to a day,
triage. Covers `src/components/board/**`, the to-do sheet, the ⌘K palette,
the `?` help sheet, Overdrive, settings (a sheet inside the board), History,
and the day sheet. Two shells: `desktop-board.tsx` at ≥640px (full layout at
≥1024px, tablet tuning between) and `phone-board.tsx` below 640px.

## Audience and job

The solo owner of the board, mid-day or in a planning session, mostly on a
keyboard. Second audience: an agent reading the screen. The job in one line:
get an idea out of your head in seconds, then put it on a day or let it go.

## Primary actions, in weight order

1. Quick-add into a list (Backlog first).
2. Drag (or keyboard-move) a card onto a day.
3. Check it off; or open Overdrive and give stalled cards an ending.
4. Open a card to expand it: notes, sub-tasks, when, priority.

## Proof and content

Real user data only. Seed lists come from `SEED_LISTS`. Empty states teach
the next action; they never celebrate or scold.

## Constraints for this surface

- `docs/DESIGN.md` wins on every visual question; read §1 (color grammar) and
  §5 (things that look like design but are load-bearing) before any change.
- Density is a feature. Do not trade cards-per-screen for whitespace.
- Today is the only card-like surface; columns are air.
- Keyboard parity for every new control, registered in `src/lib/shortcuts.ts`.
- Accessible names stay stable: "Backlog", "Overflow" and column titles are
  e2e selectors and agent anchors.
- Every change must be expressible as a token or a named rule, so the
  upcoming SwiftUI app can port it (PRODUCT.md, principle 6).
- Code-first always (Impeccable builds app screens code-first).

## Memorable moment (incumbent)

The drag from a list up onto a day, and the checked-box spectrum flash. Keep
both; refine, do not replace.

## Unresolved

- Phone shell work paused after M3 (`docs/MOBILE.md`); decide whether this
  pass touches it or only audits it.
- EI-271 (V6 audit) and EI-270 (V5 motion) overlap this pass; fold or close
  them during EI-350.
- Six known drifts between `docs/DESIGN.md` and code are listed in
  `.ai/impeccable-baseline-runbook.md`.
