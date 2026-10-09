# Product

<!-- impeccable:product-schema 1 -->

The durable product record that design work reads before it touches a pixel.
It holds product truth only. How Faite looks is `docs/DESIGN.md` (the spec of
record) and its token mirror `DESIGN.md`; what one page is for is its surface
brief in `.impeccable/surfaces/`. When this file and a `docs/` file disagree,
the `docs/` file wins and this one gets fixed.

## Platform

web

The board ships as a web app (desktop and phone layouts), a PWA, and a Tauri
Mac app that loads the same build. A **native iOS app (SwiftUI) is upcoming**
and is the reason this design pass happens now: see Product Principles §6.

## Users

One person planning their own life. Faite is solo-user through v1
(`docs/ARCHITECTURE.md` §2.10): no teams, no sharing, no assigned work. The
ideas on the board are the user's own, which is why it never nags
(`docs/RESEARCH.md` §2.3).

*Inferred from the product, not stated in a doc:* the primary user is
keyboard-heavy and keeps one planner across work and personal life (the sync
milestone is described as "a work and a personal machine", and the product
ships a Raycast extension, an API and an MCP server). Their job, in order:
catch an idea the moment it appears, decide which day it belongs to, and give
everything an honest ending.

A second user is an **agent** acting for that person, through MCP or the REST
API, or by reading the screen. Design for both.

## Product Purpose

Faite is a local-first weekly planner. *Faite* is "done" in French; the
double meaning is the point: you control your fate by getting things done.

The board is two halves and dragging between them is the whole app. The top
half is a calendar, one column per day plus **Overflow**. The bottom half is
your **lists**. You capture into a list, then drag the to-do up onto a day to
commit to it. Missed to-dos roll forward through **the Faite Loop**; after a
set number of rolls they fall into Overflow, and **Overdrive** is how you
clear it.

Success is not an empty list. Success is that every captured idea gets one of
three honest endings: **you do it, you send it back, or you let it go**
(`docs/RESEARCH.md` §1).

## Positioning

- **Capture is separate from commitment.** A list is where an idea waits; a
  day is a promise. Dragging a card onto a day is the act of committing, not
  decoration (`docs/RESEARCH.md` §2.3).
- **Missing a date is normal, and the board forgives it.** The order you chose
  was right; only the date was optimistic. Rollover is computed every render,
  never stored, and has no "never overflow" escape hatch.
- **Won't do is a real ending, not a failure.** Overdrive forces the decision
  on stalled work because the cost is in the limbo, not in either outcome.
- **Local-first.** Everything reads and writes to IndexedDB. It works offline
  by construction, no request is ever on the interaction path, and the board
  needs no account.

## Operating Context

- **Planning sessions at a keyboard.** The target is that a planning session
  never needs the mouse (`docs/KEYBOARD.md`). ⌘K palette, `?` help sheet,
  arrow-key navigation across the whole board, keyboard drag.
- **Capture from anywhere.** Quick-add with tokens (`buy milk p2 fri 2pm
  @groceries #urgent`), ⌘K, email forwarded to a private `…@in.myfaite.app`
  address, the Raycast extension, the REST API and MCP. All of it lands in
  **Backlog**.
- **Triage in bursts.** Overdrive: one card at a time, ← Won't do, ↑ Done,
  ↓ Back to its list, → Schedule.
- **A day has context.** Each day has a Markdown day note and a timeline;
  **History** looks back at past days.
- **Agents in the loop.** An agent (first consumer: Pointer) reads and writes
  through MCP at `/mcp` and REST at `/api/v1`, with an API key from
  Settings → API Keys.

## Capabilities and Constraints

**Terminology (use these words exactly).** The UI says "to-do"; code says
`todo`. Board, calendar half, planning half, day column, **Today**, list,
**Backlog**, tab, label, **Overflow**, **the Faite Loop**, **Overdrive**,
day note, day sheet, History, quick-add, reminder preset. A to-do's status is
`open | done | dropped`; the UI label for `dropped` is **"Won't do"**, never
"canceled" or "deleted". Scheduled date and deadline are different things; a
deadline never moves a card.

**Name collision.** Impeccable's `/impeccable overdrive` command ("push past
conventional limits") is unrelated to Faite's **Overdrive** triage overlay.
Never rename, restyle or "push" the Overdrive feature because a command shares
its name.

**Capabilities.** Lists (each list is a column; a to-do is in exactly one),
tabs that group lists, labels (many per to-do; chips and filters, never
columns), sub-tasks (one level, inside the parent's sheet only), repeating
to-dos (skip the Loop; a miss goes straight to Overflow with a "×N missed"
badge), priority P1–P4, scheduled date and time, deadline, reminders
(foreground only), location, attachments, day notes, saved views, activity
feed, undo (no redo, on purpose), opt-in "GOOD JOB" confetti.

**Surfaces.**

| Surface | Where | Notes |
|---|---|---|
| The board | `/board` | Desktop shell at ≥640px, phone shell (swipe pager, Days \| Lists switch) below. No sign-in gate |
| Marketing site | `/`, `/about`, `/help`, `/support`, `/contact`, `/docs`, `/download`, `/colophon`, `/privacy`, `/terms` | `/` is a six-beat scroll story with a 3D room, driven by one table (`STORY_BEATS`) |
| Auth | `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/signed-out` | Signing in adds sync; it never gates the board |
| Mac app | Tauri, `/download` | Same build as the web; background sync |
| Raycast | extension | Private org for now; homepage says "Coming to the Raycast Store" |
| MCP + REST | `/mcp`, `/api/v1`, docs at `/docs` | One service layer under both |
| **Native iOS** | **upcoming** (SwiftUI) | Not started on `main`; this pass prepares it |

**Hard constraints future work must keep.**

- No streaks, scores, percentages, or progress gamification
  (`docs/RESEARCH.md` §2.9 and §4 are binding). The one narrow exception is
  per-list completion counts in History's hover card.
- No notifications meant to bring the user back. No nagging copy.
- The homepage demo board may show only features the product has
  (`docs/HOMEPAGE.md` §4), and `demo-board.tsx` / `story-panel.tsx` ship zero
  client JS.
- Every marketing claim traces to a `docs/RESEARCH.md` §2 row; §4 lists the
  banned ones (Zeigarnik, "21 days", 23-minute refocus, and more).
- Visible labels such as "Backlog" and "Overflow" are e2e selectors
  (`docs/DESIGN.md` §5); a rename breaks tests.
- Every keyboard shortcut is registered in `src/lib/shortcuts.ts` and
  `docs/KEYBOARD.md` §1.

**Deliberately undecided.** The audience has never been formally named in a
doc. The product voice is not yet written down (`docs/CONTENT.md`). Label
colors are off "for now".

## Brand Commitments

- **Name and mark.** Faite, with the hand-drawn cursive F. The F stays black
  and white.
- **Voice.** Plain and declarative. Never nags, never judges, never shames a
  missed date. The homepage's close is the model: "That is the whole idea.
  Write it down, give it a day, and let the board carry it until you do it,
  move it, or let it go."
- **Tagline.** "Control your fate by getting things done." (`src/lib/site.ts`)
- **American English** in all copy, `aria-label`s, toasts and comments:
  color, organize, canceled, center, gray. Quotes, paper titles, package
  names and licence names keep their own spelling (`docs/CONTENT.md` §3).
- **The board is free and works offline, with no account.** The main call to
  action is "Open the board"; signing up is second.
- **The 3D room credits its CC-BY creators** on `/colophon`. A credit no user
  can reach is a license the site does not have.

## Evidence on Hand

- **Research:** `docs/RESEARCH.md`, verbatim quotes with DOIs for every
  feature (capture, implementation intentions, rollover, disengagement,
  action crisis). Use it; never paraphrase a quote with the citation attached.
- **Product reasoning:** `docs/ARCHITECTURE.md`, `docs/FAITE-LOOP.md`,
  `docs/OVERDRIVE.md`, `TODO-ITEM-DESIGN.md`.
- **Real UI:** the running app. Screenshots on the marketing site are
  captures, not mockups.
- **Absent, and must not be invented:** testimonials, customer logos, user
  counts, usage statistics, press, pricing tiers, ratings, "N% of to-dos"
  claims.

## Product Principles

These are the owner's six goals for Faite, stated 2026-10-08, each tied to
where the product already keeps it.

1. **Plan around your days.** A to-do becomes real when it has a day. The
   calendar half is the top of the board for that reason; lists feed it.
2. **Rolling over is fine; getting it done is what counts.** A missed to-do
   moves forward to today instead of rotting on a past date. Nothing on the
   board treats a roll as a failure.
3. **Won't do is an honest choice.** Sometimes the thing you thought mattered
   doesn't. Dropping it is a real ending, shown dimmed, never struck through
   (a strike claims credit for work that was abandoned).
4. **The Backlog is a capture engine.** It is the quiet place every idea lands
   first, from every input, and it can't be deleted.
5. **Fast, from idea to captured in seconds.** Capture costs nothing; you can
   expand the idea right away or later. No network request on the
   interaction path; motion arrives in under 260 ms.
6. **Works with agents.** Agents use MCP and the REST API, which share the
   board's own logic (an agent's `get_overflow` is the same function the board
   renders with). Agents that read the screen must be able to, too: every
   control has an accessible name, labels are stable, and state is visible
   rather than implied by color alone. The same discipline makes the upcoming
   iOS app cheaper, because a design expressed as tokens and named rules ports
   to SwiftUI; a web-only trick does not.

## Accessibility & Inclusion

- Shortcuts are an accelerator, never the only route. No global
  single-character shortcuts except `?`. Results are announced, not only
  shown.
- Drag-and-drop works from the keyboard and speaks its own announcements.
- Hit areas at least 24×24 px (WCAG 2.2); 44 px in Overdrive on touch.
- Focus ring at 5.12:1. Colored text never at the smallest size.
- The **Hyperlegible** font pairing exists for low-vision readers. Do not
  claim it is "proven" more legible.
- Reduced motion removes the overshoot, and the state it announces must be
  correct with the animation removed.
- The homepage reads fully with no JavaScript and no WebGL.
