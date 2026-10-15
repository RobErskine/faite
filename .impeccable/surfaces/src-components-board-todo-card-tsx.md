---
version: 1
slug: "src-components-board-todo-card-tsx"
primary_target: "src/components/board/todo-card.tsx"
related_targets: ["src/components/board/todo-row-parts.tsx","src/components/board/overdrive-card.tsx"]
---

# Surface: the to-do row ("anatomy of a to-do")

## Scope and mode

**Mode: Operate.** One to-do as it renders everywhere: board columns
(calendar and planning halves), Overflow, the Overdrive card, ⌘K search
results, the drag chip, and (later) the homepage demo board, which must
mirror it. Files: `src/components/board/todo-card.tsx`,
`src/components/board/todo-row-parts.tsx` (`TodoMetaBadges`, `todoRowName`),
`src/components/board/overdrive-card.tsx`, the to-do rows in
`command-palette.tsx`, `src/components/ui/checkbox.tsx`, `src/lib/priority.ts`.

## Audience and job

Someone scanning a whole week in seconds, and an agent reading the screen.
A row must say, at a glance and in its accessible name: what it is, how
important, when, and where it stands in the Faite Loop (rolled, in
Overflow, done, Won't do).

## Anatomy (current, keep unless the critique proves otherwise)

Left to right: drag grip (hover on desktop, visible on phone) · priority
rail (double/solid/dashed/dotted, 5/3/2/2px, `--foreground` at falling
opacity — form, never hue) · square checkbox · title (clamped, first-line
indent so wrapped lines run under the checkbox) · meta badges (time,
deadline, location, recurrence ×N, sub-tasks, attachments, labels,
scheduled date, rolled ↳ marker, Overflow age "since Oct 6 · 9 days").

## Constraints for this surface

- `docs/DESIGN.md` wins; read §1 (one meaning per color channel; red = a
  verdict is due; no colored text at the smallest size), §3, §5, and
  `TODO-ITEM-DESIGN.md` §10.
- **Every badge or glyph needs a clause in `todoRowName`**, or it is visible
  but silent. The name starts with the title.
- `done` is struck through; Won't do (`dropped`) is dimmed only — no word,
  no strike (owner decision 2026-10-15).
- The No-Shame Rule: a rolled card keeps its look; only the muted ↳ and a
  tooltip. Red only on Overflow's column rule/count and a missed deadline.
- Checkbox stays 24px wide on touch so it never covers the grip; long-press
  the row to drag on touch (DRAG-AND-DROP §5.4). Rows are 44px tall on touch.
- Density is a feature: a 168px column must still read. No new color, no
  spectrum outside its four places.
- Must port to SwiftUI: express decisions as tokens or named rules.

## Memorable moment (incumbent)

The check: the checkbox's spectrum flash on open → done, and the strike.
Keep it; refine it (EI-270 covers animating the strike).

## Unresolved

- Badge overflow on narrow columns when a row carries many badges.
- Whether the meta row should collapse rarely-needed badges behind the
  title tooltip.
