# Design

The spec of record for how Faite looks and moves. `src/app/globals.css` is
the implementation; this file is the reasoning. When the two disagree, fix one
of them the same day. The marketing site consults §6 before it invents anything.

The brief (2026-09-03): Notion's utility, MyMind's calm design and whimsy, the
reliability of a Casio F-91W. Snappy and native. The hand-drawn cursive F stays
black and white; the app gets one low-chroma "spectrum" as its pop of color,
the way the Dia mark does. Nothing on the board reads as generic shadcn.

The North Star (2026-10-14): **The Forgiving Page.** The board should feel
calm and plain, exact and fast, kind and forgiving. It must never look like a
generic shadcn/SaaS app, a gamified habit app, or a corporate project tool. A
missed date is ordinary: a rolled card keeps its look (a muted arrow and a
tooltip, nothing louder), and red waits until a verdict is due.

---

## 1. Color grammar

Every color on the board belongs to exactly one channel. A channel means one
thing. If a new element needs color, it takes the channel that already means
that thing, or it stays achromatic.

| Channel | Means | Implemented by | Where it appears | Never |
|---|---|---|---|---|
| **Identity hue** (user-chosen per tab or list, including Tomato) | "belongs to X" | `src/lib/colors.ts`: `wash()` 5%, `tint()` 12%, `edge()` 35%; `effectiveListColor()`; `labelInk()` / `labelChipStyle()` for a label chip's text | wash behind a run of rows, tint on group and tab headers, edge rule under a column title, label chips (tint and edge; the text is `labelInk`), confetti | raw hue as text, at any size; on a card body |
| **Urgent** (`--urgent`, an alias of `--destructive`) | "needs a verdict now" | `--urgent`, `--urgent-foreground`, `--urgent-soft`; `badgeVariants({ variant: "destructive" })`. Red **text** is always `--urgent-foreground` at `text-xs` or larger, on the 10% tint; bare `--urgent` is for rules and outlines only. The Overflow rule is `border-urgent/70`, the alpha that clears 3:1 on `surface-0` in both themes | the Overflow column's edge rule and count (both only while it holds something), missed Deadline, `×N` missed occurrences, N due banner, drop-refused outline | red text at `text-2xs`; a second red anywhere, and the per-card Overflow age ("since Oct 6 · 9 days", EI-390; "In Overflow" is left to the column), which is muted ink: the column already says it once (EI-374). Users may pick Tomato for a list; the app itself adds no other red |
| **Priority** | importance | `src/lib/priority.ts` `PRIORITY_RAILS` | the card's left rail: P1 5px double, P2 3px solid, P3 2px dashed, P4 2px dotted, all `--foreground` at falling opacity | hue. Line style, thickness and opacity carry all four levels (decision A; styles added 2026-09-10, §7) |
| **Spectrum** (`--spectrum`, `--spectrum-solid`) | "Faite, here, now" | `hairline-spectrum` utility; `--spectrum-solid` for rings | four places only: the F mark on hover and focus, the today column's top hairline, the checked-box flash, the focus ring | a fill, a text color, a badge, a fifth place |
| **Status** (`--warning`, `--info`, `--success`, each with `-foreground` and `-soft`) | system state | `bg-warning-soft text-warning-foreground` and siblings | desktop and auth banners, toasts | board content |
| **Form** (strike-through, dim) | done / dropped | both settled statuses in `text-foreground/60`, the quiet ink that passes; `line-through` on a `done` title's text (not its badges); the priority rail at 40% of its opacity on either (`todo-card.tsx`, `SETTLED_RAIL_OPACITY`) | rows | color. `dropped` never gets the strike; a strike says "this got done" |

The identity ladder is a ladder because the gaps are the point: a rule at 35%,
the header under it at 12%, the field behind the cards at 5%. Wash and tint
were once 10% and 12%, which is inside the noise. Hue rides borders and fills,
never text, because a Radix step-9 hue at `text-2xs` fails contrast in one
theme or the other. Label chips used to be the one exception, and measured
1.4–3.9:1 (EI-395). Now the hue keeps the chip's tint and edge, and its text is
`labelInk`: `color-mix(in oklab, <hue> 30%, var(--foreground))`. The chip
still reads as its color, and the ink takes its contrast from the foreground,
which flips with the theme: every preset clears 7.7:1 on its chip, on any
surface, under the hover wash, in both themes, and so does a pure black or
white hue (5.2:1). `colors.test.ts` recomputes that number; raise the 30% and
it says by how much it stopped passing.

The spectrum is peach → rose → lavender → sky at low chroma. It is a hairline
and a flash. It never covers area. Dia's rule applies: things change color,
not position.

## 2. Type roles

Components reference roles, never families.

| Role | Token / utility | Use |
|---|---|---|
| `font-sans` | `--font-sans` → `--app-sans` | body |
| `font-heading` | `--font-heading` → `--app-heading` | titles, sheet/dialog headings |
| `font-mono` | `--font-mono` → `--app-mono` | code, `kbd` |
| `num` | utility, `--app-numeric` + tabular figures | a number that stands alone: a date, a count, a time |
| `nums` | utility, tabular figures only | a number inside a sentence |
| `type-column-title` | utility: heading face, bold, uppercase, tight tracking | column titles, strips, the create-list tile. Size stays at the call site (`text-lg` on a column, `text-sm` on a strip) so the utility never fights a size class |
| `type-eyebrow` | utility: `text-2xs`, medium, uppercase, wide tracking, muted | subtitles, group headers, timeline day labels |

`text-2xs` is 10px under Editorial and **11px under Hyperlegible**, with the
same 14px line height in both, so no row changes height. It resolves through
`--app-text-2xs`, set per pairing next to the families: the theme block is
`@theme inline`, so only a `var()` lets the utility follow `data-font`. Not
12px, because that is `text-xs`, and the step between the two is what keeps
an eyebrow quieter than what it labels.

**The to-do row's badge grammar** (EI-395, `src/lib/row-grammar.ts`) is
stricter than the table above, because a row's badges sit side by side and a
mix of faces reads as noise:

- **Type.** `num` only for a badge that is nothing but a count ("1/3", "3").
  Anything with a word or a date in it — "Oct 12", "2:00 PM", "☕ Afternoon",
  "Deadline Oct 12", "since Oct 6 · 9 days" — is `nums`. One family per
  badge.
- **Size.** Every badge is `text-2xs` on the 20px pill, except the two red
  verdicts (missed deadline, "Missed ×N"), which are `text-xs`: colored text
  is never at the smallest size (§1).
- **Icons.** Every glyph on a row is 12px in muted ink, a title marker and a
  badge's icon alike; the badge's words keep the badge's ink. The red
  verdicts carry no icon. One icon, one meaning (`ROW_ICONS`): ↳ rolled, a
  flag for a deadline ahead, Repeat for a series, a pin, a calendar for the
  scheduled date, a clock for the time, a checklist for sub-tasks, a clip
  for attachments.
- **Order** (`ROW_BADGE_ORDER`): the verdict (missed deadline, missed
  occurrences, Overflow age), then when (date, then time), then progress
  (sub-tasks, attachments), then identity (labels). The title's glyphs run
  ↳, deadline, repeat, pin. The row's accessible name (`todoRowName`) reads
  in the same order.
- **One anatomy, four densities.** The board card, the ⌘K result, the
  Overdrive card and the drag chip (`drag-chip.tsx`) all build the row from
  `todo-row-parts.tsx` — rail, title glyphs, badge line, name — and vary
  only density: Overdrive's 16px glyphs by a 24px title; the drag chip's
  two-line clamp, its rail as a border and no hover text. A to-do with no
  list is named "Backlog" wherever a row names its list (`NO_LIST_NAME`):
  `buildBoard` puts it there.

Two pairings, selected by `data-font` on `<html>`:

| id | Sans / heading | Mono / numeric | Role |
|---|---|---|---|
| `editorial` (default for new accounts) | Source Sans 3 / **Source Serif 4** | IBM Plex Mono | the stylized first impression |
| `hyperlegible` | Atkinson Hyperlegible Next | Atkinson Hyperlegible Mono | the clear option, purpose-designed for low-vision readers |

Removed ids (`precision`, `systematic`) still parse: `normalizeFontPairing()`
in `src/lib/fonts.ts` maps them to the default at read time, because the
value syncs from other devices and old rows still carry it.

**tailwind-merge caveat.** An `@utility` is opaque to `cn()`. If a caller
follows `type-eyebrow` with `text-primary`, the override wins by cascade
order, not by merging. Check the compiled order once when you add one. See
`.ai/lessons.md` on shorthand versus per-axis classes for the same trap.

## 3. Surfaces, lines, shadows

Four surfaces, three lines, three shadows. Every shadcn token keeps its name;
these sit on top and say what a region *is*.

| Token | Light | Dark | Region |
|---|---|---|---|
| `--surface-sunken` | `oklch(0.955 0 0)` | `oklch(0.165 0 0)` | inset form controls (the header search); retired as a board floor |
| `--surface-0` | `oklch(0.985 0 0)` | `oklch(0.19 0 0)` | a control that must read as one: the weekend strip, a collapsed rail |
| `--surface-1` | `oklch(1 0 0)` | `oklch(0.225 0 0)` | today — the board's only card |
| `--surface-2` | `oklch(1 0 0)` + `shadow-card` | `oklch(0.27 0 0)` | raised: the active tab pill, a popover |
| `--line-faint` | `oklch(0.945 0 0)` | `oklch(1 0 0 / 6%)` | the split handle at rest, "no matches" |
| `--line` | = `--border` | = `--border` | ordinary rules |
| `--line-strong` | `oklch(0.85 0 0)` | `oklch(1 0 0 / 18%)` | reserved for intent states (the split handle on hover/drag) |
| `--shadow-card` | soft 1px, `-1px` spread | 1px + inset light hairline, `-1px` spread | today's card, a raised pill |
| `--shadow-raised` | 2–8px | same, deeper | popovers, menus |
| `--shadow-overlay` | 12–32px | same, deeper | dialogs, sheets |

Columns are **air** since the Air pass (which retired V3.5's panels — see the
decisions log): no borders, no backgrounds, one continuous `--background`
paper under both halves. Whitespace is the only column separator — a 12px
`gap-3` (mirrored by `DAY_GAP_PX` in desktop-board.tsx, which the rigid
column-width calc must keep in step with) — and a column is held together by
its own header and left alignment edge. Rows inside a column have **no
dividers** — separation is spacing (36px rhythm, `py-2`; 44px under `pointer: coarse`, see Touch targets below) and the hover wash,
not rules.

**Today is the board's only card**: `--surface-1` + `shadow-card` + the
spectrum hairline, and no border — the shadow carries the edge (in dark, via
its inset hairline). Overflow carries an `--urgent` edge rule (at 70%) and its count,
so it reads as a queue with pressure. Backlog carries an eyebrow, no accent,
and the one always-visible quick-add placeholder, so it reads as quiet
intake. The titles of days that are not today sit in `--muted-foreground`;
today's and Overflow's keep full ink. Day eyebrows use the short date with
no year ("Sep 5"); the full date lives in the day sheet and aria labels.

**Today is also the board's widest day** (desktop only, EI-384). Day columns
are rigid and come in three widths, all floored at `--column-floor` (168px):
Today is `--column-today-ratio` (**1.5**) times its neighbor; the other days
on Today's first page share what is left (`--column-near`), so Today plus
them fill the track exactly as N equal columns used to; every later day keeps
the old equal width (`--column-min`/`--column-max`), so a page jumped ahead is
N equal columns. When the floor binds — a seven-day week on any window under
~1600px — near and far are both 168px and Today (252px) is the only column
that changes. Measured at 1440×900 (track 1174px): Today plus five days, and
10px of the sixth. A seven-day week did not fit at 1440 before this either
(seven floors need 1248px since Overflow became a pinned 242px rail). Tablet
and phone keep equal columns. The range title ends at the last day at least a
third on screen. Arithmetic: `src/components/board/day-track-widths.ts`.

**The date row is three groups, not a row of peers** (desktop and tablet,
EI-392): *where* — History and the range title; *what* — "View: …" (statuses,
Show weekends, Saved views) and the day count; *move* — ‹ Today › Jump and
Activity. ‹ and › step one page and are disabled, not hidden, at the ends, so
the cluster never shifts under the pointer; Today is always there and
disabled on today. Jump is one popover: Next/Previous week, month and
quarter beside the calendar. A control that moves the board never looks like
a control that changes the view. The phone bar keeps its own short set
(Overflow peek, History, range, Today, the date picker, Activity).

Overflow and Backlog are the two exceptions to "columns are air": both carry
`bg-surface-0` even though neither is `emphasis`. Both are resizable rails
(`RailHandle`), and with no fill at all their whole region — not just the
1.5px drag handle — was hard to register as "an adjustable width," not just
"a column." `RailHandle` itself also carries a `border-line-faint` hairline
at rest now, matching `SplitHandle`'s treatment; it used to be fully
invisible until hovered.

Two states that no surface token can express, because they must go the
opposite way in each theme:

- **Hover and focus-within** on a row or group header is ink at 5%:
  `bg-foreground/5`. It darkens in light and lifts in dark with one class,
  and still composites over a 5% identity wash.
- **Focus ring** is `--ring`, which is `--spectrum-solid`. Focus is "here,
  now", which is what the spectrum means. This is one of its four places.

**Overlays** (`ui/dialog.tsx`, `ui/sheet.tsx`, `ui/alert-dialog.tsx`,
`ui/command.tsx`) speak the board's language, not shadcn's defaults:
`DialogTitle`/`SheetTitle`/`AlertDialogTitle` are a real heading step
(`text-lg font-semibold tracking-tight`, still `font-heading`), not a label
that happens to sit in the serif face. Footers are a `border-line-faint`
hairline, never a filled `bg-muted` bar — the Air pass left exactly one
filled panel-within-a-panel in the app, and this was it. Radius is
`rounded-3xl` on every overlay's outer popup, concentric with its buttons'
`--radius-md`: outer = inner + the `p-5` padding between them, per
`better-ui`'s rule. The `⌘K` palette's input sits on `--surface-sunken`, the
same recessed surface its header trigger button does, so opening it reads as
the same field growing rather than a handoff to a different component. Every
button on the board — inside an overlay or out — shares one `focus-ring`
utility (`ui/button.tsx`), not shadcn's `border-ring ring-3 ring-ring/50`.
So does the checkbox (`ui/checkbox.tsx`, EI-395): its shadcn halo was the ring
at 50%, 1.97:1. The to-do title is the one variation, `focus-ring-notched`:
the same 2px line drawn round an L that steps round the checkbox sitting in
the title's top-left corner, so "open" and "complete" never read as one
control. The title's hit area is unchanged; only the drawing moved.

### Touch targets

Every control is at least **24×24 with a mouse** (WCAG 2.2 Target Size,
Minimum) and **44×44 under `pointer: coarse`** (the iOS floor). The visible
mark does not grow; the target does, by one of three means, in this order of
preference:

1. **A `py-* -my-*` pair** — padding grows the box, the negative margin gives
   the same space back, so nothing moves. Use it on anything that carries
   tooltips inside it (the card title): a pseudo-element on top would swallow
   their hover. It is clipped by any `overflow: hidden` ancestor, hit testing
   included, so a truncating parent must hand truncation to the control (the
   day name).
2. **An `::after` extender** (`relative` + `after:absolute after:-inset-*`),
   stated per axis, when there is free space around the mark that belongs to
   nothing else — header icons, the wordmark, the ⚡. Lopsided insets are
   fine; the ⚡ takes 8px left and 2px right because the column edge is 2px
   away. A pseudo-element is placed from the **padding box**, so on a
   bordered control (the checkbox) every inset is 1px short of what it says.
3. **A real height**, `pointer-coarse:min-h-11`, when the neighbors are
   themselves targets that fill their space and an extender could only steal
   from them: card rows (36px → 44px on touch), list-group headers (24 → 44),
   the quick-add (36 → 44). This is the one that changes phone density, and
   it is the iOS list-row height.

Two more rules, both from EI-392:

- **Neighbors' extenders share the gap between them, never more.** Two
  extenders that overlap give every tap in the overlap to the later element,
  so the earlier one measures short. The header's Keyboard shortcuts button
  (6px each side) and the avatar (8px) asked for 14px of a 12px `gap-3`, and
  shortcuts measured 42 wide; the avatar now takes 6 left and 10 right.
- **An extender stays inside its container's box.** Past it, it lands on a
  neighbor that is a target itself. Phone Backlog's header is 42px, so Quick
  sort's 44px extender ran 2px under the first card's title; its coarse
  margin is trimmed so the header grows to 44, and the extender shifts to fit
  it exactly (6 up, 4 down).

Exempt by design: the card and column **grips** are 12×24. On touch they are
affordances, not targets — a long press anywhere on the row or header drags
(`docs/DRAG-AND-DROP.md` §5.4). The card checkbox is **24×44**, not 44 wide,
for the same section's reason. The two targets meet without overlapping: with
a mouse the grip is x=0–12 and the checkbox x=12–36. On touch the row's left
gutter is 24px, not 12 (EI-395), because a phone column's edge is the
screen's and its grip is always visible: the rail steps 4px in (x=4), the
grip sits at x=10–22, clear of even a P1's 5px rail, and the checkbox runs
x=24–48.

## 4. Motion policy

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 100 ms | hover, fill, color |
| `--dur-base` | 180 ms | the strike, the check flash, a card scaling in |
| `--dur-slow` | 260 ms | a drop settling |
| `--ease-out-soft` | `cubic-bezier(.22, 1, .36, 1)` | anything that lands |
| `--ease-spring` | `cubic-bezier(.34, 1.56, .64, 1)` | nothing, since EI-395: the check flash animates `box-shadow`, so it lands on `--ease-out-soft`. Kept for a `transform` that wants a pop |
| `--ease-spring-travel` | `linear(…)`, 350 ms | something that **travels** between two places |
| `animate-check` / `animate-strike` / `animate-settle` | `--animate-*` in `@theme` | see `globals.css`. `animate-strike` draws the `strike-draw` line (a background, so a wrapped title draws every line at once) |

Rules:

- **Arrival** is under 260 ms (`--dur-slow`). A spring's **settle tail** may run
  to ~400 ms, and only on `transform` — the thing is where it belongs within
  the budget, and what follows is the overshoot dying out. Confetti is still
  the one exception to the budget itself, and still opt-in (GOOD JOB mode,
  `src/lib/celebrate.ts`).
- A spring goes on `transform`. Never on `background-color`: a color cannot
  overshoot, so the spring buys nothing and the tail only makes it mushy. Never
  overshoot `opacity` either — past 0 and 1 it clips, which reads as a flicker.
  Anything that tints, fades, or reflows takes a fixed duration.
- Reduced motion drops the **overshoot**, not just the animation: swap the
  spring for `--ease-out-soft`, or `transition-none`. A spring is the one case
  where removing the animation and removing the motion are different edits.

### The completion beat

Ticking a to-do is the one moment the row earns (EI-395). Before it, under
the default View (open to-dos only) the board dropped the row in the same
render that marked it done: the card unmounted ~90ms after the click, the
check flash never played, and the strike was never seen. Now the **column**
holds the row (`use-completion-beat.ts`, rules in `lib/completion-beat.ts`),
because the card is the thing that leaves and cannot keep itself rendered.

| From the click (the beat starts on the tick) | What happens |
|---|---|
| 0–180ms | The box checks with the spectrum flash (`before:animate-check`, an opacity and scale ring on `check-ring`'s `::before`, on `--ease-out-soft`, never a spring) and the strike draws left to right (`animate-strike`, a `scaleX` on one `strike-line` overlay per title line) |
| 180–260ms | The finished row stands still, to be read. The drawn strike swaps for `line-through` at the same height (measured per face: `--strike-y`, `--strike-thickness`) |
| 260–360ms | Default view: the row fades on `--dur-fast`, inert, and keyboard focus moves to the row that takes its place (else the one above, else the quick-add) |
| 360–620ms | The row goes; the rows below close the gap on a transform (`--dur-slow`, `--ease-out-soft`, WAAPI, so dnd-kit's inline transform is untouched) |

Under **View: All** the row stays on the board, so instead of fading it is
held at its old place for the beat and then slides to its new one (settled
work sinks), with its neighbors, on the same transform. **Reduced motion**
keeps the beat — the checked, struck row is the confirmation, and it is
state, not motion — and drops the flash, the draw, the fade and the slide:
the row is removed in one step at 260ms. **Undo** wins at any point: once
the data says open again the row renders from the data. A row that was the
last of its list group brings the group back with it for the beat. A write
that has not landed 2s after the click stops being held.

**The tick lands on the click (EI-399).** The beat used to start when the write
reached the store, ~147ms after the click on production, and the board's
re-derive then ran as a 92ms long task inside the 180ms flash, so the strike
popped across one frame. Now the card keeps a local `pendingDone`: the box
checks and the flash and strike start on the click frame (or Space), before the
write. If the write fails, the tick reverts and the existing error path toasts.
`pendingDone` clears when the store catches up, and clears itself `GIVE_UP_MS`
after a write that resolved without ever flipping the store. Only open → done
is optimistic; reopening has no beat to start early.

Both effects animate `transform` and `opacity` only, so they run on the
compositor and a busy main thread cannot make them pop. The flash is a ring on
a `::before` (`check-ring`) that grows from the box's edge to 6px out
(`scale(1)` → `scale(1.75)`) while it fades; it is invisible at rest. The
strike is a `scaleX(0)` → `scaleX(1)` overlay (`strike-line`) per rendered
line of the title, placed on the text's measured line boxes, so every wrapped
line draws at once and sits at the same `--strike-y` and `--strike-thickness`
as before. Both are 180ms on the same easing; `motion-reduce` removes both,
and the resting state of each (ring invisible, line fully drawn) is the
correct one. The write itself, and with it the toast, the confetti and the
board re-derive, is led by `TICK_LEAD_MS` (34ms, about two frames) in
`use-completion-beat.ts`, so it lands after the first frames of the beat
rather than inside them.

### How an overlay arrives

A sheet slides in from its own `data-side`, travelling **its own size** —
`slide-in-from-right-full`, not a fixed nudge. A dialog depends on how much of
the screen it is taking: under `sm` it rises from the bottom like a sheet;
above `sm` it scales in place from 0.95, because travelling up from the bottom
edge of a wide display is a long journey to a place it does not belong. Every
backdrop fades on `--dur-base`, never a spring.

Entrances ride `--ease-spring-overlay` over `--dur-overlay`. Exits are shorter
(`--dur-overlay-exit`) and unsprung.

Two rules with teeth:

- **The vocabulary is `data-open` / `data-closed`.** `@base-ui/react/dialog`
  emits those. It does **not** emit `data-starting-style` /
  `data-ending-style` — `@base-ui/react/drawer` does, which is exactly how
  `ui/sheet.tsx` ended up with a full set of transition rules that never ran
  and a sheet that appeared instead of sliding. If an overlay is not moving,
  check which attribute it is keyed on before changing any value.
- **An overlay can only animate out if it is still mounted while it closes.**
  `<Sheet open>` with a hardcoded `open`, under a parent that stops rendering
  it, has no closing state to animate — the subtree leaves the tree in the
  same commit and the panel does not slide, it ceases to exist. Pass a real
  boolean and hold the outgoing content with `useExitRetained`
  (`src/lib/use-exit-retained.ts`). Entry working is not evidence that exit
  works; they fail independently.
- **An edge-anchored surface never overshoots.** A spring's eased progress
  passes 1, so a panel anchored to the right edge travels past its resting
  place and visibly parts from that edge for a few frames. Sheets take
  `--ease-out-soft`; only centered things (a dialog scaling in place) may
  spring. Overshoot is also read as a fraction of what moves: 4.9% is life on
  a 145px pill and wobble on a 680px panel, which is why
  `--ease-spring-overlay` is gentler than `--ease-spring-travel`.
- **Never move a primitive's positioning into a breakpoint.** `command.tsx`
  and `overdrive-overlay.tsx` override `DialogContent`'s centering
  *unprefixed*; a base that states it at `sm:` cannot be beaten by them. Add
  motion with a keyframe animation, which composes its own transform, rather
  than by re-anchoring layout.
- Every animation carries `motion-reduce:animate-none`. The state it announces
  must be correct with the animation removed.
- An animation keys on a **transition**, never on a state. A row that mounts
  already done renders the static strike. See `.ai/lessons.md` on the
  render-time `lastSeen` pattern; no `useEffect` for this.
- The spectrum changes color, not position.
- No streaks, counters, or progress gamification. `docs/RESEARCH.md` §2.9 and
  §4 are binding. One narrow exception, per-list counts in History's hover
  card, is §7's 2026-09-11 row.
- Snappy and native: prefer a color or opacity change to a layout change.
  Prefer `transform` to anything that reflows.

## 5. Things that look like design but are load-bearing

Read `docs/DRAG-AND-DROP.md` §6 and `TODO-ITEM-DESIGN.md` §10 before touching
a row. In short:

- The priority rail is an absolutely positioned span, never `border-l`.
- The row is not a flex container. Grip and checkbox sit in a 12px gutter.
- Group headers are not sticky. The wash sits on the group container, not on
  each card, so `hover:` still composites over it.
- The unchecked checkbox uses `border-muted-foreground`, not `border-input`,
  because `--input` vanishes over a colored wash. It is square.
- Pinned rails are flex siblings outside the scroll track, not `sticky`.
- `pager-column` gets no `touch-action`. Ever.
- e2e selectors are accessible names. "Backlog" and "Overflow" are names in
  tests. Renaming a visible label costs a spec update.

## 6. For the marketing site

Reuse, do not invent:

- Color: `--background`, `--foreground`, `--muted-foreground`, the surface
  and line tokens above, and the spectrum in one place per page at most.
- Type: `font-heading` for headings, `font-sans` for body, `num` for any
  date. The site renders in the default pairing; do not add a third family.
- Motion: the same three durations. Nothing autoplays except a spectrum shimmer
  under 260 ms on a hover.
- Do not add a brand color beyond the spectrum. Do not add a hero gradient
  that covers area. Do not add streak, count, or "N% of to-dos" claims;
  `docs/RESEARCH.md` §4 lists the banned ones.

### The homepage story is the one sanctioned exception to §4

`/` runs a scroll-driven 3D room and a card that flies across the page. That
breaks two rules above on purpose, and the exception does not generalize:

- **"Nothing runs longer than 260 ms"** does not apply to scroll-driven motion.
  Nothing here has a duration at all — every value is a pure function of scroll
  position, so the reader sets the pace and can stop, reverse, or skip it. That
  is a different thing from an animation that plays at you, and it is why the
  policy's real concern (waiting on the UI) never arises.
- **"Prefer a color or opacity change to a layout change"** is broken
  deliberately by `card-travel.tsx`, which reflows width and height once a
  frame on one small subtree. `scale()` is the cheaper, wrong answer: it would
  zoom the title from 14px to 35px and blur every glyph, when what the card
  does is widen and unfold. See `docs/HOMEPAGE.md` §5.

Everything else holds, and two of them harder than elsewhere: **the state must
be correct with the motion removed** (reduced motion, no WebGL and no
JavaScript each render a true static story, not an empty shell), and **no
gamification** — the card ticks off a plan being finished, and there is no
streak, score, or percentage anywhere in it.

## 7. Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-09-03 | **A.** Priority rail goes achromatic: thickness and opacity only. | The old rail's red, orange, blue, and cyan were the same hues as the list presets and the urgency red. A Tomato "VIP" list next to a red "In Overflow" badge and a red P1 rail could not be told apart. Red now means urgency only. |
| 2026-09-10 | **Priority gets four line styles: double, solid, dashed, dotted** for P1–P4, with thickness stepping down alongside (5 / 3 / 2 / 2px). | A width ramp answers "which of these two is higher" but never "what is this one" — a level had to be compared against a neighbour to be read. Line style is identifiable alone and is still form rather than color, so decision A stands untouched. Double leads because it reads as emphasis before you know the scale, and it is the one style that needs width to exist (two strokes and a gap; 2/1/2 at 5px). CSS's four `border-style` values mapping 1:1 onto four levels is the point: the drag chip and the sheet's priority tab draw the mark as a real border and no longer approximate. A same-day first pass used dash rhythms only and read as too similar. |
| 2026-09-03 | **B.** Spectrum = peach → rose → lavender → sky, low chroma. `--spectrum-solid` = lavender. | A pop of color in the Dia style that no list preset owns. Four fixed places, never a fill. |
| 2026-09-03 | **C.** Two pairings: Editorial and Hyperlegible. Precision and Systematic removed. | Four pairings diluted the identity. One stylized, one clear. |
| 2026-09-03 | **D.** Editorial is the default for new accounts. Existing rows keep their stored value. | The serif heading is the first impression that matches the brief. Existing users see no change. |
| 2026-09-03 | Users keep full control of list colors, Tomato included. | A list color is the user's, not the app's. The app keeps its own red out of the presets' way by owning only urgency. |
| 2026-09-03 | Backlog and Overflow keep their names. | Both are e2e names and both are understood. |
| 2026-09-03 | Tab counts stay `lists/items/assigned`. | The third number exists because a tab can read `3/0/1` while its lists all look empty. A glyph on the third number says "above" without the tooltip. |
| 2026-09-05 | `--spectrum-solid` darkened in light theme: `oklch(0.7 0.1 300)` → `oklch(0.55 0.13 300)`. | The focus ring is this token, and at 0.7 it measured 2.76:1 on white — under WCAG's 3:1 non-text floor. 0.55 measures 5.12:1, same hue. Dark theme already passed (8.29:1) and is unchanged. |
| 2026-09-05 | **The Air pass** retires V3.5's panels: no column borders or backgrounds, no sunken floor, no rail divider; whitespace (12px `gap-3`) is the only column separator, and today is the board's only card (`--surface-1` + `shadow-card` + hairline, borderless). | The panel treatment put ~15 bordered boxes on one screen — the user read it as busy, twice. Space groups first, background shapes second, separator lines last; the board now runs that ladder in order. |
| 2026-09-05 | Day eyebrows drop the year: `formatShortDate` ("Sep 5"), not "Sep 5, 2026". | The year, stamped across eight columns, was the loudest repeated text on the board and is almost never the information being sought. The full date stays in the day sheet and aria labels. |
| 2026-09-05 | Overlays (dialog, sheet, alert-dialog, command palette) join the board's own language: real heading-weight titles, hairline footers instead of filled bars, concentric `rounded-3xl`, one shared `focus-ring`, the palette's input on `--surface-sunken`. | User: "I don't want the app to feel like stock shadcn or tailwind." The board had already left shadcn's defaults behind; its overlays hadn't. |
| 2026-09-05 | `--shadow-card` gains a `-1px` spread on its primary layer, matching `--shadow-raised`/`--shadow-overlay`. | Box-shadow blur spreads sideways as much as down. On today's column (tall) and the active tab pill (wide), the un-spread blur read as an unwanted vertical border on either edge — reported independently as "today has a border-right" and "the tab pill has left/right borders." One token fix for both. |
| 2026-09-05 | Overflow and Backlog get `bg-surface-0` back, and `RailHandle` gets a resting `border-line-faint` hairline. | The Air pass made both rails' resize edges invisible until hover — "difficult to see the edges to grab in order to resize them." A tinted region plus a hairline handle restores discoverability without reintroducing a bordered panel. |
| 2026-09-05 | Overflow gets a real empty state (`OverflowEmptyState`): "No items", a Collapse button on desktop, an (i) tooltip explaining what Overflow is. | Overflow has no quick-add row, so an empty Overflow rendered nothing at all — no cue it was the empty state and not a loading gap. |
| 2026-09-05 | The `⌘K` palette opens at `top-20`, not `top-1/3`. | It should read as the header's own search field growing open, not as an unrelated dialog appearing mid-page. |
| 2026-09-07 | **The homepage hero is the board itself** — a hand-written Server Component echo (`demo-board.tsx`), cropped by the fold rather than scaled down. | A screenshot goes stale and a video cannot be flown across the page on scroll. Rendering the board as HTML costs `/` zero client JS *and* lets one card physically travel into the story. A desktop board shrunk to fit is a picture of something broken, not a smaller picture of the truth. |
| 2026-09-07 | **The demo board may not show a feature the product does not have.** Colored labels removed; column accents kept. | There is no label color picker in Faite, but `todo-row-parts.tsx` will happily tint a label that carries a hex — so the fabricated ones rendered convincingly. That only looks wrong *after* someone signs up. Lists and tabs both mount a real `ColorPicker`, so a column accent is honest. Enforced by `demo-board.test.ts`. |
| 2026-09-07 | **Scroll-driven motion on `/` is exempt from the 260 ms ceiling**, and `card-travel.tsx` may reflow one subtree per frame. | Neither is an animation that plays at you: the reader sets the pace and can stop or reverse it. `scale()` would have been cheaper and wrong — it blurs every glyph while zooming a 14px title to 35px, when what the card does is widen and unfold. §6 has the full carve-out. |
| 2026-09-09 | **The motion ceiling is restated against *arrival*, not total elapsed time**: arrival stays under `--dur-slow` (260 ms), and a spring's settle tail may run to ~400 ms on `transform` only. | A spring has no fixed duration, so the old flat 260 ms forbade one outright. Splitting the two lets a thing be where it belongs on time and let its overshoot die out afterwards — the overlay spring is 95% arrived at 137 ms and still settling at 340 ms. Color, opacity and anything that reflows keep fixed durations. |
| 2026-09-09 | **Springs are CSS, not a dependency.** `--ease-spring-travel` / `--ease-spring-overlay` are `linear()` curves sampled from a damped harmonic oscillator, constants in the `globals.css` comment. | The prompt was [Fluid Hover](https://www.fluidfunctionalism.com/docs/fluid-hover), which is good code and wanted `framer-motion` — the board's first animation dependency, for a hover wash. `linear()` has been Baseline since Dec 2023 and gives real spring physics with zero runtime. It also could not have gone on to-do columns anyway: it measures with `offsetTop` while dnd-kit moves rows with transforms, and its gap-click would route an empty-space click onto a to-do's completion checkbox. |
| 2026-09-09 | **The hover wash is asymmetric**: in on `--dur-fast`, out on `--dur-base`. | Sweeping a pointer down a column fades every row it crosses both in and out, and at one speed that reads as a strobe. Leaving slower turns the rows behind the cursor into a wake. It is also the first thing to actually use `--dur-fast`, which had been defined and documented as "hover, fill, color" and referenced by nothing. |
| 2026-09-10 | **An edge-anchored surface never overshoots.** Sheets take `--ease-out-soft`; only centered things (a dialog scaling in place) may spring. | A spring's eased progress passes 1, so a right-anchored panel travels past its resting place and visibly parts from the edge it is attached to. 4.9% is 7 px on a 145 px tab pill and 33 px of daylight on a 680 px sheet — overshoot has to be read as a fraction of what is moving, which is also why `--ease-spring-overlay` is gentler than `--ease-spring-travel`. |
| 2026-09-10 | **An overlay is mounted for the whole of its close.** `useExitRetained` holds the outgoing value; `<Sheet open>` with a hardcoded `open` is a bug. | Five overlays returned `null` the moment their prop cleared, so closing was not a state they passed through — the subtree left the React tree in the same commit and Base UI never marked the popup `data-closed`. They did not animate away; they stopped existing. Entry working is not evidence that exit works. |
| 2026-09-11 | **History's hover card may count, per list.** Hovering a day with completions (EI-324) lists each list's completions, most first (`7 ☑ Personal Project`), each row in its list's tint. Never a day's total, never on the calendar itself, never compared across days; no streak count and no "longest run". Won't do is not counted. | The one exception to §4's no-counters rule, and a narrow one. The cell's tint says which list a day was about at one fixed strength; the card says why, and a per-list breakdown the user asks for is a description of a day, not a score to beat — the same footing as Overdrive's end-of-session tally (RESEARCH.md §2.9). Days are square with no gap, so same-color days join into a bar: what a run of days was about, with no number on it. |
| 2026-10-14 | **The North Star is "The Forgiving Page".** Six words, held as three pairs: calm and plain, exact and fast, kind and forgiving. Anti-references: generic shadcn/SaaS, a gamified habit app, a corporate project tool. | Chosen by the owner during `/impeccable document`, to match the positioning in `PRODUCT.md` (forgiveness and honest endings). It names what the existing rules already do — the rolled-card marker is muted, Won't do dims instead of striking, red means a verdict is due — so it adds no new token. |
| 2026-10-14 | **Overflow's red lives on the column, not the cards.** The per-card "In Overflow N days" age is a muted outline badge, and the column's urgent rule, like its count, draws only when the column holds something. Subtitle: "Waiting for an ending". | Every card in Overflow wore the same red pill, so the column read as a wall of red repeating one fact N times, and red at `text-2xs` broke PRODUCT.md's "colored text never at the smallest size". The No-Shame Rule wants the age told quietly, like the rolled-over marker; urgency is said once, by the column (EI-374). |
| 2026-10-14 | **Quiet ink that must pass is `text-foreground/60`, and every control clears 24px** (EI-378). Tab counts, the header search label and avatar initials moved off `text-muted-foreground` (or its alphas); grips and small icon controls moved off `/30`–`/70` to full `text-muted-foreground`. Small targets grow by an `::after` extender or a `py-1 -my-1` pair, never by visual size; header icons extend to 44px under `pointer: coarse`. The quick-add takes `focus-ring`. Overflow's red count is `text-xs` in `--urgent-foreground`. | Measured on production: tab counts 2.3:1, the sunken search label 4.16:1, initials 4.35:1, grips 1.47:1; `--urgent` text on its own 10% tint, 3.83:1. Muted ink is 4.73:1 on the page but drops under 4.5:1 on any of the board's tinted surfaces (sunken, hover wash, a tab's 12% tint); foreground at 60% clears all of them in both themes and reads as the same gray. A target grown by padding-with-negative-margin or a pseudo-element changes no row height, so density holds. |
| 2026-10-14 | **Small and thin red passes contrast** (EI-382). The missed-deadline and `×N` badges and the N-due banner take `--urgent-foreground` at `text-xs`, like Overflow's count; the `destructive` badge variant itself now inks in `--urgent-foreground`. Overflow's rule is `border-urgent/70`. Under Hyperlegible `text-2xs` is 11px. The to-do checkbox's target is a full 24px wide (`after:w-6`). | Measured on production: `--urgent` at 10px on its tint, 3.97:1 (3.46:1 under the hover wash); the rule at /40, 2.09:1 light and 1.98:1 dark on `surface-0`, under the 3:1 non-text floor. Now the red text is 8.76:1 light and 7.50:1 dark at worst, and the rule 3.51:1 and 3.68:1. Hyperlegible exists for low-vision readers and left the smallest size alone. The checkbox's `::after` is placed from inside its 1px border, so `-inset-x-1` gave 22px; `w-6` makes it 24 and keeps the left edge clear of the grip (DRAG-AND-DROP §5.4). |
| 2026-10-14 | **One meaning per icon, and no number without its words** (EI-383). ↳ (`CornerDownRight`) marks a rolled to-do and nothing else; the Overflow age badge is words only. Every icon-only header button (the day ⚡, Quick sort) shows its accessible name as a tooltip, and a tab's `4/3/↑8` tooltip names all three numbers, in order, in the same words its accessible name uses. | The second critique found ↳ on both the rolled marker and the Overflow age, an unlabeled ⚡ beside a labeled "Overdrive · N", and tab counts nobody could read without already knowing them. A glyph that means two things means neither. |
| 2026-10-14 | **Today gets room** (EI-384): on desktop, Today is `--column-today-ratio` (1.5×) its neighbor. The other days on Today's first page narrow to share the track (`--column-near`); later pages keep N equal columns; every width keeps the 168px floor. Tablet and phone are unchanged. The range title names every day at least a third on screen. | Today absorbs rolled cards, "Schedule for Today" and finished work, so it is the busiest column, and at 168px it showed under half of 13 to-dos beside near-empty days. 1.5× is a ratio, so it ports to SwiftUI as a frame multiplier. At 1440 the floor binds and seven days already scrolled (track 1174px vs 1248 needed), so no factor could make a week fit there. 1.5× costs the half-column of Tuesday that showed before (Today + 5 days + 10px). At 1280: Today + 4 days + 30px, and Week still steps 6. At 1920 the week still fits: 316px Today, 211px days. The old title rounded, so a column a little under half visible showed on screen but not in "Oct 14 – Oct 19". |
| 2026-10-15 | **Touch targets reach 44px under `pointer: coarse`, and rows grow to make room** (EI-388). Card rows are 44px on touch (the title fills the row), list-group headers and the quick-add are 44px; the ⚡, the day name and the wordmark extend to 44 without growing. With a mouse the group header gains its missing pixel (23 → 24) and the wordmark a `py-0.5 -my-0.5` pair (20 → 24); nothing else moves. §3 "Touch targets" is the recipe. | Measured on production at 390×844 with touch: title 370×27, quick-add 390×36, ⚡ 34×34, group header 390×23, day name 100×28, wordmark 31×20. At 36px rows a 44px title could only overlap its neighbors, and the later row wins every tap in an overlap, so the row grows instead: 44 is iOS's own list-row floor. After, at the same size: title 349×44 (the checkbox's strip excluded), quick-add 390×44, ⚡ 44×44, group header 390×44, day name 84×44, wordmark 48×44, checkbox 24×44. At 1440×900: rows 35.25 as before. |
| 2026-10-15 | **The Overflow age says since when and how long, in one string everywhere** (EI-390): "since Oct 6 · 9 days", and "since today" on the day it crosses (`formatOverflowAge`). Board card, Overdrive card, ⌘K row, Settings example and homepage replica all show it; the accessible name and tooltip say "In Overflow since Oct 6, 9 days". Set in `nums`, not `num` — a phrase, not a standalone number (§2). It stays one unit at the 168px floor; the one string too wide for it (a start in another year, in Hyperlegible) breaks between its halves, never inside one. | The age read three ways: "9 days" on the board, "In Overflow 9 days" in ⌘K, and a bare "42 days" under Overdrive's "Scheduled Aug 30" that read as "42 days late". A count alone says how long but not since when; a date alone makes the reader do the arithmetic. EI-387's `overflowWording` variants go: one string needs no switch. |
| 2026-10-15 | **The date row is where, what, move** (EI-392): History and the range; one "View" menu (statuses, Show weekends, Saved views) beside the day count; ‹ Today › and one "Jump" popover holding Next/Previous week, month and quarter beside the calendar, then Activity. ‹ › step one page and disable rather than vanish; Today disables on today. History, Activity, ‹ and › show their names as tooltips. Phone targets: the N-due banner, the tab name, Archived and the signed-out banner's Sign up reach 44 on touch; two §3 "Touch targets" rules added (neighbors share a gap; an extender stays in its container). | The fourth critique counted ten peer controls in the date row, and "Week › Month › Quarter ›" read as view switches — "Month" looked like a month view and scrolled 28 days. Folding them into Jump keeps every move a click or two away and stops them claiming to be views; Weekends and Saved views are part of what you are viewing, so they went into View. No capability moved more than one click deeper. Measured at 390×844 with touch, before → after: N-due banner 389×26 → 389×44, Keyboard shortcuts 42×44 → 44×44, Sign up 47×29 → 47×45, My Lists 82×24 → 82×44, Archived 36×44 → 44×44, Quick sort 43×42 → 45×44. With a mouse nothing moved. |
| 2026-10-15 | **The to-do row, polish pass 1** (EI-395): the completion beat (§4) — a ticked row holds checked and struck for one beat, then fades and the rows below close the gap on a transform, or under View: All slides to its new place; the flash lands on `--ease-out-soft`, not a spring. Label chip text is `labelInk` (30% hue into the foreground), retiring §1's one exception. Done and Won't do share `text-foreground/60`; Won't do stays dim-only. The strike is on the title text, not the badges. The Overflow age moves to `text-foreground/60`. A settled row's rail keeps 40% of its opacity. The checkbox takes `focus-ring`; the title's outline steps round it (`focus-ring-notched`). The row's inline `transition` composes dnd-kit's `transform` with the wash and the fade (`rowTransition`). | Measured on the board (light / dark, at rest → under the hover wash): label text 1.6–3.9:1 → 9.7–13.2 / 8.5–10.7; Won't do 2.71 / 3.92 → 5.25 / 6.6 (5.10 / 6.06 hovered); done hovered 4.27 → 5.10 / 6.06; Overflow age hovered 4.1 → 5.02 / 6.46. Under the default View the row used to unmount ~90ms after the click and the confirmation was a toast in the corner. The hover wash never animated at all: the inline `transition: transform 0ms linear` dnd-kit leaves on every row replaced the class's list; it now fades in over 100ms. A struck label chip read as "label removed", and a P1 double rail at full ink was the loudest mark on a finished row. |
| 2026-10-15 | **The to-do row, polish pass 2** (EI-395): one badge grammar in `lib/row-grammar.ts` (§2) — `num` for a bare count only, `nums` for anything with a word or a date; every badge `text-2xs` except the two red verdicts at `text-xs`, which lose their icons; every row glyph 12px in muted ink; one icon per meaning (the time wears a clock, not a bell; a deadline ahead is a flag; the Repeat icon means "repeats" and nothing else); verdict → when → progress → identity. One anatomy on four surfaces: the board card, ⌘K, the Overdrive card (now with the rail, ↳, the pin, the flag and the counts) and the drag chip (`DragChip`: all title glyphs, the badge line, a two-line clamp, the settled rail), all from `todo-row-parts.tsx`. "Backlog" is the word for a to-do with no list everywhere (`NO_LIST_NAME`; ⌘K said "Unfiled"). On touch the row's gutter is 24px, the rail 4px in from the screen edge, the grip clear of it; the grip's 12×24 target and the checkbox's 24-wide one meet at x=12 instead of overlapping by 3px. The rolled tooltip's separator is "·", like its neighbors. | The pass-2 critique scored Consistency 2/4: the row was assembled four ways, so Overdrive dropped the rail, ↳, pin and counts, ⌘K dropped the counts and the drag chip dropped ↳ and the flag, and truncated the title to one line. Inside the row, one badge mixed mono and sans ("Deadline Oct 12"), badges came in two sizes, the scheduled and deadline calendars could not be told apart, Repeat meant both "repeats" and "missed", and the red missed deadline sat fourth in line. Measured live (1440 mouse): grip 12×24 at x=0–12, checkbox 24 wide at x=12–36 (it used to start at x=9, leaving the grip 9×24). At 390 touch: rail x=4–7, grip x=10–22, checkbox x=24–48, where the rail used to be flush with the glass and the always-visible dots touched a P3/P4 rail. Recurring occurrences showing no deadline, sub-task or attachment badges is the data model, not a lost badge: `cloneOccurrence` drops the series' deadline on purpose, and an occurrence's sub-tasks and attachments are its own. |
| 2026-10-16 | **The completion beat lands on the click** (EI-399): the tick is optimistic — the box checks and the flash and strike start on the click from a local `pendingDone`, which reverts if the write fails and gives up `GIVE_UP_MS` after a resolved write that never flips the store. The flash is an opacity/scale ring on a `::before` and the strike a `scaleX` overlay per title line (measured line boxes), both compositor-only at 180ms on the same easing; `motion-reduce` removes both. The write, the toast, the confetti and the board re-derive are led by `TICK_LEAD_MS` (34ms). | Measured on production: the box checked ~147ms after the click, a 92ms long task landed at ~162ms, and the strike popped from 38% to 99.7% across one 119ms gap. The flash animated `box-shadow` and the strike `background-size`, both main-thread, so a busy thread made them jump. |
