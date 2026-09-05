# Design

The spec of record for how Faite looks and moves. `src/app/globals.css` is
the implementation; this file is the reasoning. When the two disagree, fix one
of them the same day. The marketing site consults §6 before it invents anything.

The brief (2026-09-03): Notion's utility, MyMind's calm design and whimsy, the
reliability of a Casio F-91W. Snappy and native. The hand-drawn cursive F stays
black and white; the app gets one low-chroma "spectrum" as its pop of colour,
the way the Dia mark does. Nothing on the board reads as generic shadcn.

---

## 1. Colour grammar

Every colour on the board belongs to exactly one channel. A channel means one
thing. If a new element needs colour, it takes the channel that already means
that thing, or it stays achromatic.

| Channel | Means | Implemented by | Where it appears | Never |
|---|---|---|---|---|
| **Identity hue** (user-chosen per tab or list, including Tomato) | "belongs to X" | `src/lib/colors.ts`: `wash()` 5%, `tint()` 12%, `edge()` 35%; `effectiveListColor()` | wash behind a run of rows, tint on group and tab headers, edge rule under a column title, label chips, confetti | on `text-2xs` text; on a card body |
| **Urgent** (`--urgent`, an alias of `--destructive`) | "needs a verdict now" | `--urgent`, `--urgent-foreground`, `--urgent-soft`; `badgeVariants({ variant: "destructive" })` | In Overflow badge, missed Deadline, `×N` missed occurrences, N due banner, drop-refused outline, the Overflow rail's edge rule | a second red anywhere. Users may pick Tomato for a list; the app itself adds no other red |
| **Priority** | importance | `src/lib/priority.ts` `PRIORITY_RAILS` | the card's left rail: P1 3px, P2 2px, P3 1px, P4 1px dotted, all `--foreground` at falling opacity | hue. Thickness and opacity carry all four levels (decision A) |
| **Spectrum** (`--spectrum`, `--spectrum-solid`) | "Faite, here, now" | `hairline-spectrum` utility; `--spectrum-solid` for rings | four places only: the F mark on hover and focus, the today column's top hairline, the checked-box flash, the focus ring | a fill, a text colour, a badge, a fifth place |
| **Status** (`--warning`, `--info`, `--success`, each with `-foreground` and `-soft`) | system state | `bg-warning-soft text-warning-foreground` and siblings | desktop and auth banners, toasts | board content |
| **Form** (strike-through, dim) | done / dropped | `line-through` on `done`; `opacity-70` on `dropped` (`todo-card.tsx`) | rows | colour. `dropped` never gets the strike; a strike says "this got done" |

The identity ladder is a ladder because the gaps are the point: a rule at 35%,
the header under it at 12%, the field behind the cards at 5%. Wash and tint
were once 10% and 12%, which is inside the noise. Hue rides borders and fills,
never text, because a Radix step-9 hue at `text-2xs` fails contrast in one
theme or the other. Label chips are the one exception: the chip's text takes
the label's hue, on a tint of the same hue.

The spectrum is peach → rose → lavender → sky at low chroma. It is a hairline
and a flash. It never covers area. Dia's rule applies: things change colour,
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

Two pairings, selected by `data-font` on `<html>`:

| id | Sans / heading | Mono / numeric | Role |
|---|---|---|---|
| `editorial` (default for new accounts) | Source Sans 3 / **Source Serif 4** | IBM Plex Mono | the stylised first impression |
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
dividers** — separation is spacing (36px rhythm, `py-2`) and the hover wash,
not rules.

**Today is the board's only card**: `--surface-1` + `shadow-card` + the
spectrum hairline, and no border — the shadow carries the edge (in dark, via
its inset hairline). Overflow carries an `--urgent` edge rule and its count,
so it reads as a queue with pressure. Backlog carries an eyebrow, no accent,
and the one always-visible quick-add placeholder, so it reads as quiet
intake. The titles of days that are not today sit in `--muted-foreground`;
today's and Overflow's keep full ink. Day eyebrows use the short date with
no year ("Sep 5"); the full date lives in the day sheet and aria labels.

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

## 4. Motion policy

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 100 ms | hover, fill, colour |
| `--dur-base` | 180 ms | the strike, the check flash, a card scaling in |
| `--dur-slow` | 260 ms | a drop settling |
| `--ease-out-soft` | `cubic-bezier(.22, 1, .36, 1)` | anything that lands |
| `--ease-spring` | `cubic-bezier(.34, 1.56, .64, 1)` | the check flash only |
| `animate-check` / `animate-strike` / `animate-settle` | `--animate-*` in `@theme` | see `globals.css` |

Rules:

- Nothing runs longer than 260 ms except confetti, which is opt-in
  (GOOD JOB mode, `src/lib/celebrate.ts`).
- Every animation carries `motion-reduce:animate-none`. The state it announces
  must be correct with the animation removed.
- An animation keys on a **transition**, never on a state. A row that mounts
  already done renders the static strike. See `.ai/lessons.md` on the
  render-time `lastSeen` pattern; no `useEffect` for this.
- The spectrum changes colour, not position.
- No streaks, counters, or progress gamification. `docs/RESEARCH.md` §2.9 and
  §4 are binding.
- Snappy and native: prefer a colour or opacity change to a layout change.
  Prefer `transform` to anything that reflows.

## 5. Things that look like design but are load-bearing

Read `docs/DRAG-AND-DROP.md` §6 and `TODO-ITEM-DESIGN.md` §10 before touching
a row. In short:

- The priority rail is an absolutely positioned span, never `border-l`.
- The row is not a flex container. Grip and checkbox sit in a 12px gutter.
- Group headers are not sticky. The wash sits on the group container, not on
  each card, so `hover:` still composites over it.
- The unchecked checkbox uses `border-muted-foreground`, not `border-input`,
  because `--input` vanishes over a coloured wash. It is square.
- Pinned rails are flex siblings outside the scroll track, not `sticky`.
- `pager-column` gets no `touch-action`. Ever.
- e2e selectors are accessible names. "Backlog" and "Overflow" are names in
  tests. Renaming a visible label costs a spec update.

## 6. For the marketing site

Reuse, do not invent:

- Colour: `--background`, `--foreground`, `--muted-foreground`, the surface
  and line tokens above, and the spectrum in one place per page at most.
- Type: `font-heading` for headings, `font-sans` for body, `num` for any
  date. The site renders in the default pairing; do not add a third family.
- Motion: the same three durations. Nothing autoplays except a spectrum shimmer
  under 260 ms on a hover.
- Do not add a brand colour beyond the spectrum. Do not add a hero gradient
  that covers area. Do not add streak, count, or "N% of to-dos" claims;
  `docs/RESEARCH.md` §4 lists the banned ones.

## 7. Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-09-03 | **A.** Priority rail goes achromatic: thickness and opacity only. | The old rail's red, orange, blue, and cyan were the same hues as the list presets and the urgency red. A Tomato "VIP" list next to a red "In Overflow" badge and a red P1 rail could not be told apart. Red now means urgency only. |
| 2026-09-03 | **B.** Spectrum = peach → rose → lavender → sky, low chroma. `--spectrum-solid` = lavender. | A pop of colour in the Dia style that no list preset owns. Four fixed places, never a fill. |
| 2026-09-03 | **C.** Two pairings: Editorial and Hyperlegible. Precision and Systematic removed. | Four pairings diluted the identity. One stylised, one clear. |
| 2026-09-03 | **D.** Editorial is the default for new accounts. Existing rows keep their stored value. | The serif heading is the first impression that matches the brief. Existing users see no change. |
| 2026-09-03 | Users keep full control of list colours, Tomato included. | A list colour is the user's, not the app's. The app keeps its own red out of the presets' way by owning only urgency. |
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
