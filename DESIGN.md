---
name: Faite
description: "Control your fate by getting things done."
colors:
  background: "oklch(1 0 0)"
  background-dark: "oklch(0.145 0 0)"
  foreground: "oklch(0.145 0 0)"
  foreground-dark: "oklch(0.985 0 0)"
  primary: "oklch(0.205 0 0)"
  primary-dark: "oklch(0.922 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-dark: "oklch(0.269 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  muted-foreground-dark: "oklch(0.708 0 0)"
  popover: "oklch(1 0 0)"
  popover-dark: "oklch(0.205 0 0)"
  border: "oklch(0.922 0 0)"
  border-dark: "oklch(1 0 0 / 10%)"
  surface-sunken: "oklch(0.955 0 0)"
  surface-sunken-dark: "oklch(0.165 0 0)"
  surface-0: "oklch(0.985 0 0)"
  surface-0-dark: "oklch(0.19 0 0)"
  surface-1: "oklch(1 0 0)"
  surface-1-dark: "oklch(0.225 0 0)"
  surface-2: "oklch(1 0 0)"
  surface-2-dark: "oklch(0.27 0 0)"
  line-faint: "oklch(0.945 0 0)"
  line-faint-dark: "oklch(1 0 0 / 6%)"
  line-strong: "oklch(0.85 0 0)"
  line-strong-dark: "oklch(1 0 0 / 18%)"
  spectrum-peach: "oklch(0.85 0.08 55)"
  spectrum-peach-dark: "oklch(0.8 0.08 55)"
  spectrum-rose: "oklch(0.82 0.09 10)"
  spectrum-rose-dark: "oklch(0.78 0.09 10)"
  spectrum-lavender: "oklch(0.8 0.09 300)"
  spectrum-lavender-dark: "oklch(0.78 0.09 300)"
  spectrum-sky: "oklch(0.82 0.08 230)"
  spectrum-sky-dark: "oklch(0.8 0.08 230)"
  spectrum-solid: "oklch(0.55 0.13 300)"
  spectrum-solid-dark: "oklch(0.78 0.1 300)"
  urgent: "oklch(0.577 0.245 27.325)"
  urgent-dark: "oklch(0.704 0.191 22.216)"
  urgent-foreground: "oklch(0.35 0.14 27)"
  urgent-foreground-dark: "oklch(0.88 0.07 20)"
  urgent-soft: "oklch(0.965 0.03 25)"
  urgent-soft-dark: "oklch(0.27 0.07 25)"
  warning: "oklch(0.55 0.13 75)"
  warning-foreground: "oklch(0.35 0.1 70)"
  warning-soft: "oklch(0.97 0.04 85)"
  info: "oklch(0.5 0.12 240)"
  info-foreground: "oklch(0.33 0.09 245)"
  info-soft: "oklch(0.965 0.025 230)"
  success: "oklch(0.5 0.13 150)"
  success-foreground: "oklch(0.33 0.09 150)"
  success-soft: "oklch(0.965 0.035 150)"
typography:
  headline:
    fontFamily: "Source Serif 4, ui-serif, Georgia, serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Source Serif 4, ui-serif, Georgia, serif"
    fontSize: "1.125rem"
    fontWeight: 700
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.375
  label:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
  eyebrow:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 500
    lineHeight: "0.875rem"
    letterSpacing: "0.05em"
  numeric:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontFeature: "\"tnum\", \"zero\", \"lnum\""
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  3xl: "22px"
  4xl: "26px"
  full: "9999px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-outline-hover:
    backgroundColor: "{colors.muted}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-ghost-hover:
    backgroundColor: "{colors.muted}"
  badge-urgent:
    backgroundColor: "oklch(0.577 0.245 27.325 / 10%)"
    textColor: "{colors.urgent-foreground}"
    rounded: "{rounded.4xl}"
    height: "20px"
    padding: "2px 8px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "4px 10px"
  todo-card:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    padding: "8px 8px 8px 12px"
  column-title:
    textColor: "{colors.foreground}"
    typography: "{typography.title}"
  dialog:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.3xl}"
    padding: "20px"
    width: "24rem"
---

# Design System: Faite

> Mirror of [docs/DESIGN.md](docs/DESIGN.md), which is the spec of record. Values come from src/app/globals.css. On any conflict, docs/DESIGN.md wins and this file gets fixed the same day.

## Overview

**Creative North Star: "The Forgiving Page"**

A page that keeps your whole week in front of you and never holds a missed date against you. It should feel **calm and plain, exact and fast, kind and forgiving** (owner, 2026-10-14). The brief behind it (docs/DESIGN.md, 2026-09-03): Notion's utility, MyMind's calm design and whimsy, the reliability of a Casio F-91W. Snappy and native.

Paper and ink: an achromatic page, near-black ink, and color only where a color has a job. Forgiveness is carried by form, not by a message: a rolled card looks like any other card apart from a muted arrow, Won't do dims and is never struck through, and red appears only when a verdict is due. The hand-drawn cursive F stays black and white; the one pop of color is a low-chroma spectrum, used the way the Dia mark uses it.

Density comes from structure, not decoration. Columns are air, today is the one card, priority is a mark rather than a chip, and every color answers "what does this mean?" with exactly one channel (docs/DESIGN.md §1). Motion is short and lands: a thing is where it belongs inside 260ms, and the state is correct with the motion removed (§4).

**Never looks like** (confirmed visual rejections): a generic shadcn/SaaS app (stock components, the default ring trio, gray cards on gray); a gamified habit app (streak flames, badges, scores, celebration as the default reward); a corporate project tool (assignees, status swimlanes, toolbar walls, enterprise blue).

**Key Characteristics:**
- Achromatic base (`oklch(L 0 0)` everywhere except the named channels).
- One color meaning per channel; a new element takes an existing channel or stays achromatic.
- The spectrum as a hairline, a flash and a faint column glow in five places, never area.
- Serif headings over a humanist sans (Editorial pairing); tabular numerals in mono.
- Whitespace separates columns; no borders, no dividers.
- Springs on `transform` only; arrival under `--dur-slow`.

**The No-Shame Rule.** A missed scheduled date is ordinary. A rolled to-do gets a muted `CornerDownRight` marker and a tooltip ("Rolled from Sep 5 - 3 days"), never red, a strike, or a dim. Red waits for Overflow or a missed deadline, where a verdict is due (docs/DESIGN.md brief, §1).

**The Arrival Budget Rule.** Arrival is under 260ms (`--dur-slow`). A spring's settle tail may run to ~400ms, on `transform` only. Confetti is the one exception, and opt-in. Scroll-driven motion on `/` is exempt because it has no duration (docs/DESIGN.md §4, §6).

**The Motion-Removed Rule.** Every animation carries `motion-reduce:animate-none`, and the state it announces must be correct without it. Reduced motion drops the overshoot, not just the animation: swap the spring for `--ease-out-soft` or `transition-none`. An animation keys on a transition, never on a state (docs/DESIGN.md §4).

Motion tokens (durations, easings, the two `linear()` springs) live in `.impeccable/design.json` and in `globals.css`; the policy is docs/DESIGN.md §4.

## Colors

An achromatic ink-on-paper ladder, plus five channels that each mean one thing: identity hue, urgent, spectrum, status, and form (docs/DESIGN.md §1).

### Primary
- **Ink** (`primary`, `foreground`): text, the checked checkbox, the priority rail, the drop indicator. Inverts with the theme.

### Secondary
- **Spectrum** (`spectrum-peach` → `spectrum-rose` → `spectrum-lavender` → `spectrum-sky`): the `--spectrum` gradient, reached only through the `hairline-spectrum` and `text-spectrum` utilities. Means "Faite, here, now."
- **Spectrum Solid** (`spectrum-solid`): the lavender stop alone, for the focus ring (`--ring`) and the check flash. Darkened in light theme to clear 3:1 on white (§7, 2026-09-05).

### Tertiary
- **Urgent** (`urgent`, `urgent-foreground`, `urgent-soft`): "needs a verdict now." An alias of `--destructive`. The Overflow column's edge rule (at 70%, for 3:1 on `surface-0`) and count (only while it holds something), a missed Deadline, `×N` missed occurrences, the N-due banner, a drop-refused outline. Red text is always `urgent-foreground` at `text-xs` or larger; bare `urgent` is for rules and outlines. Never the per-card Overflow age ("since Oct 6 · 9 days", EI-390), which is muted ink: the column says it once.
- **Status** (`warning`, `info`, `success`, each with `-foreground` and `-soft`): system state, for desktop and auth banners and toasts.
- **Identity hue** (user-chosen per tab or list; the ten Radix step-9 presets in `src/lib/colors.ts`): "belongs to X." Applied as a ladder: `edge()` 35% rule under a column title, `tint()` 12% on group and tab headers, `wash()` 5% behind a run of rows.

### Neutral
- **Paper** (`background`): one continuous floor under both halves of the board.
- **Muted Ink** (`muted-foreground`): titles of days that are not today, eyebrows, placeholders.
- **Surface Sunken** (`surface-sunken`): inset form controls (the header search, the `⌘K` input).
- **Surface 0** (`surface-0`): a control that must read as one; also the Overflow and Backlog rails.
- **Surface 1** (`surface-1`): today, the board's only card.
- **Surface 2** (`surface-2`): raised: the active tab pill, a popover. Equal to white in light theme; shadow tells it apart.
- **Line Faint / Line / Line Strong** (`line-faint`, `border`, `line-strong`): resting split handle and hairline footers; ordinary rules; intent states only.

### Named Rules
**The One Channel Rule.** Every color on the board belongs to exactly one channel, and a channel means one thing. If a new element needs color, it takes the channel that already means that thing, or it stays achromatic (docs/DESIGN.md §1).

**The Five Places Rule.** The spectrum appears in five places only: the F mark on hover and focus, the today column's top hairline (60% opacity at rest), the column glow (a full-outline glow at 35% on hover or keyboard focus of any non-collapsed column, fading in over 150ms, no motion under reduced motion, CSS only; collapsed rails get none), the checked-box flash, and the focus ring. Never a fill, a text color, a badge, or a sixth place. It changes color, not position (docs/DESIGN.md §1, §7 decision B).

**The One Red Rule.** Red means urgent, only. Users may pick Tomato for a list; the app itself adds no second red anywhere (docs/DESIGN.md §1, §7 decision A).

**The Form Not Hue Rule.** Priority is carried by the rail's thickness, line style and opacity, never by hue: P1 double 5px, P2 solid 3px, P3 dashed 2px, P4 dotted 2px, all `--foreground` at falling opacity (`PRIORITY_RAILS` in `src/lib/priority.ts`; docs/DESIGN.md §1, §7 decision A and 2026-09-10).

**The Strike Means Done Rule.** `done` gets a strike-through on its title text (never its badges); Won't do (`dropped`) only dims and never gets the strike, because a strike says "this got done". Both settle into `text-foreground/60`, the quiet ink that passes 4.5:1 on every surface, and the rail steps back to 40% (docs/DESIGN.md §1, §7 2026-10-15 EI-395).

**The No New Brand Rule.** The marketing site reuses the app's tokens and invents nothing: no brand color beyond the spectrum (and the spectrum in one place per page at most), no hero gradient that covers area, no third font family (docs/DESIGN.md §6).

**The Hue Rides Edges Rule.** Identity hue goes on borders and fills, never on text, because a step-9 hue at `text-2xs` fails contrast in one theme or the other. Label chips keep the hue on their tint and edge; their text is `labelInk`, 30% of the hue mixed into the foreground (7.7:1 or better for every preset, both themes). No exceptions. Never on a card body (docs/DESIGN.md §1).

## Typography

**Display Font:** Source Serif 4 (with ui-serif, Georgia), optical-size axis engaged
**Body Font:** Source Sans 3 (with ui-sans-serif, system-ui)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace), for code, `kbd`, and standalone numbers

**Character:** The Editorial pairing (the default for new accounts) sets a warm serif over a plain humanist sans: the stylized first impression the brief asks for. The Hyperlegible pairing (Atkinson Hyperlegible Next and Mono) is the clear option for low-vision readers; `data-font` on `<html>` switches between them (docs/DESIGN.md §2, §7 decisions C and D).

### Hierarchy
- **Headline** (600, 1.125rem, 1.25, tight tracking): dialog, sheet and alert-dialog titles. A real heading step, not a label in the serif face (§3).
- **Title** (`type-column-title`: heading face, 700, uppercase, -0.025em): column titles, strips, the create-list tile. Size stays at the call site (`text-lg` on a column, `text-sm` on a strip).
- **Body** (400, 0.875rem, 1.375): to-do titles and board text.
- **Label** (500, 0.875rem): buttons and tab triggers.
- **Eyebrow** (`type-eyebrow`: 500, 0.625rem, uppercase, 0.05em, muted): subtitles, group headers, timeline day labels. `text-2xs` is 0.6875rem (11px) under Hyperlegible, same line height (§2).
- **Numeric** (`num`: mono face, tabular, slashed zero, lining): a number that stands alone, such as a date, a count, a time. `nums` keeps the family and only fixes figures, for a number inside a sentence. On a to-do row's badge line only a bare count ("1/3") takes `num`; a badge with a word or a date in it is `nums` (docs/DESIGN.md §2, `lib/row-grammar.ts`).

### Named Rules
**The Roles Not Families Rule.** Components reference type roles (`font-sans`, `font-heading`, `font-mono`, `num`, `nums`, `type-column-title`, `type-eyebrow`), never families, so a pairing switch reaches every component (docs/DESIGN.md §2).

## Layout

Two halves on one paper: a calendar track (one column per day plus Overflow) over a planning track (lists, plus Backlog). Columns flex between `--column-floor` (10.5rem, 168px; chosen as the widest floor that fit a seven-day week on a 1440pt laptop, though a week has scrolled there since Overflow became a 242px pinned rail) and `--column-max` (18rem); list columns run 50px wider (`--list-column-min`). On desktop Today is `--column-today-ratio` (1.5) times its neighbor; the other days on its first page narrow to share the track (`--column-near`), and later pages keep N equal columns, all floored at 168px. At 1440 that is a 252px Today, five 168px days, and 10px of the next one. Tablet and phone keep equal columns (docs/DESIGN.md §3, §7 2026-10-14 EI-384). Overflow and Backlog are pinned rails outside the scroll track. The vertical split defaults to 56% for the calendar (`--split-top`).

Layout classes come from `resolveLayout()` in `src/lib/use-viewport.ts`: under 640px is the phone pager (one column per page, native scroll-snap); 640px and up renders `DesktopBoard` (tablet below 1024px, desktop above). Safe-area insets are named tokens (`--safe-top` and siblings).

**The Columns Are Air Rule.** No column borders or backgrounds. Whitespace (12px `gap-3`) is the only column separator, and rows have no dividers: separation is spacing (36px rhythm, `py-2`) and the hover wash. Overflow and Backlog are the two exceptions, carrying `bg-surface-0` so their resize edges register (docs/DESIGN.md §3, §7 2026-09-05).

## Elevation & Depth

Tonal surfaces first, shadow second. Four surfaces step up in lightness (`surface-sunken` → `surface-0` → `surface-1` → `surface-2`); in light theme the top two are both white and shadow tells them apart. In dark theme each shadow adds an inset light hairline, because a drop shadow alone disappears into a dark floor (docs/DESIGN.md §3).

### Shadow Vocabulary
- **Card** (`--shadow-card`): today's card, the raised tab pill.
- **Raised** (`--shadow-raised`): popovers, menus.
- **Overlay** (`--shadow-overlay`): dialogs, sheets.

Exact values, both themes, are in `.impeccable/design.json` and `globals.css`. Each primary layer has a negative spread so the blur stays below the element, not beside it (§7 2026-09-05).

### Named Rules
**The Only Card Rule.** Today is the board's only card: `--surface-1` + `shadow-card` + the spectrum hairline, and no border; the shadow carries the edge (docs/DESIGN.md §3).

**The Ink-at-5% Rule.** Hover and focus-within on a row or group header is `bg-foreground/5`: it darkens in light, lifts in dark, and still composites over a 5% identity wash (docs/DESIGN.md §3).

## Shapes

Radius derives from `--radius` (10px). Buttons and inputs are `rounded.lg`; small buttons cap at `min(--radius-md, 10–12px)`; tab triggers are `rounded.md`; badges are pills (`rounded.4xl` at 20px tall); every overlay's outer popup is `rounded.3xl` (docs/DESIGN.md §3). The checkbox is square. The priority rail on a square row is an absolutely positioned span inset 4px top and bottom, so consecutive rails read as separate ticks; never a `border-l` (§5). The spectrum hairline is a 2px ring on Today's rounded edge that follows both top corners and fades out down the sides; the priority rail on a rounded box (drag chip, Overdrive card, the sheet's priority select) is likewise a masked border ring that wraps its corners and tapers.

## Components

### Buttons
Quiet and tactile; the board has no loud fills.
- **Shape:** gently rounded (`rounded.lg`), 32px tall by default; `xs`, `sm`, `icon-xs`, `icon-sm` grow to a 44px hit area under `pointer: coarse`.
- **Primary:** ink fill with paper text. **Outline:** paper with a border, muted on hover. **Ghost:** transparent, muted on hover. **Destructive** and **Success** are soft 10% tints, not fills.
- **Hover / Focus:** every button shares the `focus-ring` utility (2px `--ring` outline, -2px offset), not shadcn's ring trio (§3). Press nudges down 1px.

### Badges
- **Urgent** (`destructive` variant, read through `--urgent`): urgent at 10% behind `urgent-foreground` text, at `text-xs`, pill shape. The only red badge (§1).
- **Row badge grammar** (`lib/row-grammar.ts`, docs/DESIGN.md §2): every badge `text-2xs` on the 20px pill but the two red verdicts (`text-xs`, no icon); `num` for a bare count, `nums` for anything with a word or a date; every glyph 12px in muted ink, one icon per meaning; order verdict → when → progress → identity.
- **Overflow age**: outline, `text-foreground/60` ink, `text-2xs` in `nums`, words only. One string everywhere it appears: "since Oct 6 · 9 days", "since today" on the crossing day; the year joins the start when it is not this year. Too wide for its row, it breaks between the halves, never inside one (§7 2026-10-15).

### Inputs
- **Style:** 32px, `rounded.lg`, `--input` border, transparent fill.
- **Focus:** border shifts to `--ring` (spectrum solid).

### To-do Row (signature)
- Not a flex row: grip and square checkbox sit in a 12px left gutter (24px under `pointer: coarse`, the rail 4px in from the screen edge); the title spans full width with a first-line indent. The grip's 12×24 target and the checkbox's 24-wide one meet without overlapping.
- One anatomy everywhere a to-do appears (board card, ⌘K, Overdrive, the drag chip), built from `todo-row-parts.tsx`; only density varies. A to-do with no list is "Backlog".
- Priority rail on the left edge per The Form Not Hue Rule; wash on the group container, not the card.
- Hover wash arrives on `--dur-fast` and leaves on `--dur-base`, so a swept column leaves a wake (§7 2026-09-09).
- Done: the completion beat (docs/DESIGN.md §4): the tick lands on the click (optimistic; reverts if the write fails): the checked-box spectrum flash (an opacity/scale ring, `before:animate-check`) and a strike drawn left to right on the title (a `scaleX` overlay per line, `animate-strike`), both compositor-only, held for one beat, then the row fades and the rows below close up on a transform (View: All: it slides to its new place). Reduced motion keeps the beat, drops the motion. Won't do: dim only.
- Focus: the checkbox takes `focus-ring`; the title's outline steps round the checkbox (`focus-ring-notched`).

### Column Header
- `type-column-title`; today and Overflow keep full ink, other days recede to muted.
- Today: spectrum hairline. Overflow: 2px urgent edge rule at 70%, only while it holds something. A colored list or tab: 2px `edge()` rule. Day eyebrows read "Sep 5", no year.

### Date Row
- Three groups, not ten peers (docs/DESIGN.md §3, §7 2026-10-15 EI-392): **where** (History, range title), **what** ("View: …" with statuses, Show weekends and Saved views; the day count), **move** (‹ Today › Jump, Activity).
- ‹ › step one page and disable at the ends rather than vanish; Today disables on today. "Jump" is one popover: Next/Previous week, month, quarter beside the calendar. A move never looks like a view switch.

### Overlays (dialog, sheet, alert-dialog, command palette)
- Popover surface, `rounded.3xl`, `p-5`, `--shadow-overlay`; heading-weight titles; footers are a `border-line-faint` hairline, never a filled bar.
- A dialog scales in place from 0.95 above 640px and rises from the bottom below it; a sheet slides its own width and never overshoots. Exits are shorter and unsprung (§4).
- The to-do details drawer (EI-396) is shaped around the quick edit: priority sits in the header with a short rail mark (no hanging tab); a quiet story line says where the to-do has been; When and Deadline, List, Labels, Location, Sub-tasks and Notes are always visible; Attachments and History are collapsed disclosures. Footer endings: Done (↑, primary ink, never green), Won't do (←, ⌘⌫), Back to <list> (↓, only when the to-do has a day), Delete (⇧⌘⌫, muted ghost icon, never red). Phone stays a full-width right panel. Toasts move clear of an open drawer (docs/DESIGN.md §3).

## Do's and Don'ts

### Do:
- **Do** take the channel that already means the thing, or stay achromatic (docs/DESIGN.md §1).
- **Do** use `bg-foreground/5` for row and group-header hover and focus-within (§3).
- **Do** give every button the shared `focus-ring` utility (§3).
- **Do** put springs on `transform` only; anything that tints, fades or reflows takes a fixed duration (§4).
- **Do** prefer a color or opacity change to a layout change, and `transform` to anything that reflows (§4).
- **Do** read docs/DRAG-AND-DROP.md §6 and TODO-ITEM-DESIGN.md §10 before touching a row (§5).
- **Do** build a to-do from the row parts (`todo-row-parts.tsx`) and the grammar in `lib/row-grammar.ts` wherever it appears; vary density, never the anatomy (§2).
- **Do** express every new decision as a token or a named rule, so the upcoming SwiftUI app can port it.
- **Do** keep a rolled card looking like any other card; the muted arrow is the whole signal (The No-Shame Rule).

### Don't:
- **Don't** add a second red anywhere in the app (§1).
- **Don't** give one icon two meanings: ↳ marks a rolled to-do and nothing else; the Overflow age badge is words only (§7, EI-383).
- **Don't** use the spectrum as a fill, a text color, a badge, or in a sixth place (§1).
- **Don't** give priority a hue (§1, §7 decision A).
- **Don't** strike through Won't do (§1).
- **Don't** put identity hue on `text-2xs` text or a card body (§1).
- **Don't** use status colors on board content (§1).
- **Don't** give a column a border or background, or divide rows with rules; Overflow and Backlog's `surface-0` is the only exception (§3).
- **Don't** fill an overlay footer with `bg-muted` (§3).
- **Don't** let an edge-anchored surface overshoot (§4).
- **Don't** let two touch extenders overlap, or one run out of its container: the later element wins every tap in the overlap (§3 Touch targets, EI-392).
- **Don't** add streaks, counters, or progress gamification (§4; docs/RESEARCH.md §2.9, §4).
- **Don't** let the board read as a generic shadcn/SaaS app: no stock ring trio, no gray card on gray, no default component left unstyled.
- **Don't** borrow from habit apps: no streak flames, badges, or scores, and no celebration unless the user opted in.
- **Don't** borrow from corporate project tools: no assignee avatars, status swimlanes, toolbar walls, or enterprise blue.
- **Don't** add a brand color beyond the spectrum, a hero gradient that covers area, or a third font family on the marketing site (§6).
