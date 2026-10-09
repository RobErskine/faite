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
    textColor: "{colors.urgent}"
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

**Creative North Star: "The Calm Instrument"**

The brief (docs/DESIGN.md, 2026-09-03): Notion's utility, MyMind's calm design and whimsy, the reliability of a Casio F-91W. Snappy and native. The board is an achromatic instrument: white paper, near-black ink, and color only where a color has a job. The hand-drawn cursive F stays black and white; the app's one pop of color is a low-chroma spectrum, used the way the Dia mark uses it. Nothing on the board reads as generic shadcn.

Density comes from structure, not decoration. Columns are air, today is the one card, priority is a mark rather than a chip, and every color answers "what does this mean?" with exactly one channel (docs/DESIGN.md §1). Motion is short and lands: a thing is where it belongs inside 260ms, and the state is correct with the motion removed (§4).

**Key Characteristics:**
- Achromatic base (`oklch(L 0 0)` everywhere except the named channels).
- One color meaning per channel; a new element takes an existing channel or stays achromatic.
- The spectrum as a hairline and a flash in four places, never area.
- Serif headings over a humanist sans (Editorial pairing); tabular numerals in mono.
- Whitespace separates columns; no borders, no dividers.
- Springs on `transform` only; arrival under `--dur-slow`.

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
- **Urgent** (`urgent`, `urgent-foreground`, `urgent-soft`): "needs a verdict now." An alias of `--destructive`. The In Overflow badge, a missed Deadline, `×N` missed occurrences, the N-due banner, a drop-refused outline, the Overflow rail's edge rule.
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

**The Four Places Rule.** The spectrum appears in four places only: the F mark on hover and focus, the today column's top hairline, the checked-box flash, and the focus ring. Never a fill, a text color, a badge, or a fifth place. It changes color, not position (docs/DESIGN.md §1, §7 decision B).

**The One Red Rule.** Red means urgent, only. Users may pick Tomato for a list; the app itself adds no second red anywhere (docs/DESIGN.md §1, §7 decision A).

**The Form Not Hue Rule.** Priority is carried by the rail's thickness, line style and opacity, never by hue: P1 double 5px, P2 solid 3px, P3 dashed 2px, P4 dotted 2px, all `--foreground` at falling opacity (`PRIORITY_RAILS` in `src/lib/priority.ts`; docs/DESIGN.md §1, §7 decision A and 2026-09-10).

**The Strike Means Done Rule.** `done` gets a strike-through; Won't do (`dropped`) only dims (`opacity-70`) and never gets the strike, because a strike says "this got done" (docs/DESIGN.md §1).

**The No New Brand Rule.** The marketing site reuses the app's tokens and invents nothing: no brand color beyond the spectrum (and the spectrum in one place per page at most), no hero gradient that covers area, no third font family (docs/DESIGN.md §6).

**The Hue Rides Edges Rule.** Identity hue goes on borders and fills, never on text, because a step-9 hue at `text-2xs` fails contrast in one theme or the other. Label chips are the one exception: hue text on a tint of the same hue. Never on a card body (docs/DESIGN.md §1).

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
- **Eyebrow** (`type-eyebrow`: 500, 0.625rem, uppercase, 0.05em, muted): subtitles, group headers, timeline day labels.
- **Numeric** (`num`: mono face, tabular, slashed zero, lining): a number that stands alone, such as a date, a count, a time. `nums` keeps the family and only fixes figures, for a number inside a sentence.

### Named Rules
**The Roles Not Families Rule.** Components reference type roles (`font-sans`, `font-heading`, `font-mono`, `num`, `nums`, `type-column-title`, `type-eyebrow`), never families, so a pairing switch reaches every component (docs/DESIGN.md §2).

## Layout

Two halves on one paper: a calendar track (one column per day plus Overflow) over a planning track (lists, plus Backlog). Columns flex between `--column-floor` (10.5rem, 168px; the widest floor that fits a seven-day week on a 1440pt laptop) and `--column-max` (18rem); list columns run 50px wider (`--list-column-min`). Overflow and Backlog are pinned rails outside the scroll track. The vertical split defaults to 56% for the calendar (`--split-top`).

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

Radius derives from `--radius` (10px). Buttons and inputs are `rounded.lg`; small buttons cap at `min(--radius-md, 10–12px)`; tab triggers are `rounded.md`; badges are pills (`rounded.4xl` at 20px tall); every overlay's outer popup is `rounded.3xl` (docs/DESIGN.md §3). The checkbox is square. The priority rail is an absolutely positioned span inset 4px top and bottom, so consecutive rails read as separate ticks; never a `border-l` (§5). The spectrum hairline is a 2px rule inset 10px from each side.

## Components

### Buttons
Quiet and tactile; the board has no loud fills.
- **Shape:** gently rounded (`rounded.lg`), 32px tall by default; `xs`, `sm`, `icon-xs`, `icon-sm` grow to a 44px hit area under `pointer: coarse`.
- **Primary:** ink fill with paper text. **Outline:** paper with a border, muted on hover. **Ghost:** transparent, muted on hover. **Destructive** and **Success** are soft 10% tints, not fills.
- **Hover / Focus:** every button shares the `focus-ring` utility (2px `--ring` outline, -2px offset), not shadcn's ring trio (§3). Press nudges down 1px.

### Badges
- **Urgent** (`destructive` variant, read through `--urgent`): urgent at 10% behind urgent text, pill shape. The only red badge (§1).

### Inputs
- **Style:** 32px, `rounded.lg`, `--input` border, transparent fill.
- **Focus:** border shifts to `--ring` (spectrum solid).

### To-do Row (signature)
- Not a flex row: grip and square checkbox sit in a 12px left gutter; the title spans full width with a first-line indent.
- Priority rail on the left edge per The Form Not Hue Rule; wash on the group container, not the card.
- Hover wash arrives on `--dur-fast` and leaves on `--dur-base`, so a swept column leaves a wake (§7 2026-09-09).
- Done: strike-through, with the checked-box spectrum flash (`animate-check`). Won't do: dim only.

### Column Header
- `type-column-title`; today and Overflow keep full ink, other days recede to muted.
- Today: spectrum hairline. Overflow: 2px urgent edge rule. A colored list or tab: 2px `edge()` rule. Day eyebrows read "Sep 5", no year.

### Overlays (dialog, sheet, alert-dialog, command palette)
- Popover surface, `rounded.3xl`, `p-5`, `--shadow-overlay`; heading-weight titles; footers are a `border-line-faint` hairline, never a filled bar.
- A dialog scales in place from 0.95 above 640px and rises from the bottom below it; a sheet slides its own width and never overshoots. Exits are shorter and unsprung (§4).

## Do's and Don'ts

### Do:
- **Do** take the channel that already means the thing, or stay achromatic (docs/DESIGN.md §1).
- **Do** use `bg-foreground/5` for row and group-header hover and focus-within (§3).
- **Do** give every button the shared `focus-ring` utility (§3).
- **Do** put springs on `transform` only; anything that tints, fades or reflows takes a fixed duration (§4).
- **Do** prefer a color or opacity change to a layout change, and `transform` to anything that reflows (§4).
- **Do** read docs/DRAG-AND-DROP.md §6 and TODO-ITEM-DESIGN.md §10 before touching a row (§5).
- **Do** express every new decision as a token or a named rule, so the upcoming SwiftUI app can port it.

### Don't:
- **Don't** add a second red anywhere in the app (§1).
- **Don't** use the spectrum as a fill, a text color, a badge, or in a fifth place (§1).
- **Don't** give priority a hue (§1, §7 decision A).
- **Don't** strike through Won't do (§1).
- **Don't** put identity hue on `text-2xs` text or a card body (§1).
- **Don't** use status colors on board content (§1).
- **Don't** give a column a border or background, or divide rows with rules; Overflow and Backlog's `surface-0` is the only exception (§3).
- **Don't** fill an overlay footer with `bg-muted` (§3).
- **Don't** let an edge-anchored surface overshoot (§4).
- **Don't** add streaks, counters, or progress gamification (§4; docs/RESEARCH.md §2.9, §4).
- **Don't** add a brand color beyond the spectrum, a hero gradient that covers area, or a third font family on the marketing site (§6).
