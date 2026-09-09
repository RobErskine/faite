# The homepage story

`/` is not a marketing page with a picture on it. It is the product, a room,
and six research-backed beats that have to agree with each other — and the
whole thing is one scroll.

This doc is the **page**: the beat table everything derives from, the
marketing components, how to change a beat, and what will bite you.
[SCENE.md](SCENE.md) is the **room** — models, materials, camera, and what the
room does during each beat. Neither repeats the other. Rationale for the
product itself is [ARCHITECTURE.md](ARCHITECTURE.md); the claims are governed
by [RESEARCH.md](RESEARCH.md); the words are governed by [CONTENT.md](CONTENT.md).

Shipped as EI-273 and its sub-issues (EI-274 – EI-280).

---

## 1. Three movements

`src/app/page.tsx` is a Server Component with three sections, plus a coda:

1. **The board.** A full viewport, cropped by the fold rather than shrunk to
   fit it. The `<h1>` is the LCP element and it is plain server HTML. One card
   on that board reads "Plan living room move".
2. **The room.** The 3D living room on the left, that same card pinned beside
   it on the right, the copy below the card. Six beats. As you scroll, the
   camera frames the object each beat is about, the room *acts out* that
   beat's to-do, and the card ticks the line off.
3. **The board again.** The plan is finished, so the page ends where it began,
   on the product, with the two ways in.

Then **the Raycast coda** (`raycast-callout.tsx`), after the call to action and
deliberately outside the three movements. Those movements make one argument;
an integration is not part of it. The coda answers the question a reader only
has once they have accepted that argument — "do I have to open the app every
time?" — which is why it must not interrupt it on the way there.

The argument only works because movements one and three are the *same board*
and the card in movement two is the *same card*. That is the entire reason for
the travel in §5 — without it a reader has no reason to connect three pictures
of one to-do.

---

## 2. Where everything lives

| File | Role |
|---|---|
| `src/app/page.tsx` | The three movements. Server Component; no client JS of its own. |
| `src/lib/story-beats.ts` | **The table.** One row per beat. See §3. |
| `src/components/marketing/demo-board.tsx` | The hero board. Server Component, zero client JS. See §4. |
| `src/components/marketing/story-panel.tsx` | The card pinned beside the room. Server Component. |
| `src/components/marketing/story-ticks.tsx` | Ticks each sub-task off on scroll. Renders `null`. See §6. |
| `src/components/marketing/card-travel.tsx` | Flies a third copy of the card from the board into the panel. The one client component here. See §5. |
| `src/components/marketing/demo-tooltip.tsx` | CSS-only tooltip, so the two Server Components stay Server Components. |
| `src/components/marketing/raycast-callout.tsx` | The Raycast coda. Server Component; two screenshots and a link. |
| `src/components/marketing/demo-board.test.ts` | The guard for §4. Scans source, not a bundle. |
| `e2e/marketing-pages.spec.ts` | Every homepage e2e test, including the no-JavaScript pass. |

The room's own files are in [SCENE.md §1](SCENE.md).

---

## 3. One table, seven readers

`STORY_BEATS` in `src/lib/story-beats.ts` is the single source of truth. A beat
row carries its copy, its citation, its sub-task, and the name of the object it
frames:

```ts
{ headline, body, claim, cite, section, subtask, focus, …badges }
```

Seven things read it, and none of them keeps its own copy:

| Reader | Takes |
|---|---|
| `app/page.tsx` | headline, body, claim, cite — the rendered copy |
| `marketing/demo-board.tsx` | `subtask` — the hero card's sub-tasks are *derived*, not written twice |
| `marketing/story-ticks.tsx` | the count, and the rolling beat's dates |
| `scene/room-camera.ts` | `focus` → a framing, and the keyframe positions |
| `scene/beat-animations.ts` | `focus` → the beat's band in global progress |
| `e2e/marketing-pages.spec.ts` | the whole array, so a beat added without copy fails |
| the unit tests | the same |

**This is the decision to protect.** The failure it prevents is specific and
was live in the spike: a to-do that gets checked off while the room visibly
does not do it is a lie told in two places at once. Beat, object, claim and
tick are one unit because they are one row.

### The two shared constants

| Constant | Where | Value | Means |
|---|---|---|---|
| `TICK_AT` | `story-beats.ts` | `0.4` | how far into its band a beat's line ticks |
| `COMMIT_AT` | `beat-animations.ts` | `0.3` | where the room's act lands — **must stay under `TICK_AT`** |

Cause, then effect: the wall is painted, *then* the card checks "Change paint
color". `beat-animations.test.ts` fails if that order flips. They live in two
files because the page needs one and the room needs both, and a shared number
is what a test can hold.

---

## 4. The invariant: `/` ships zero client JS for the board

`/` is the one page whose entire audience is a cold-cache first-time visitor —
`redirectIfKnownDevice` in `page.tsx` sends everyone who has used the board
before straight to `/board`, ahead of paint. So the hero is a hand-written echo
of the board rather than the board itself.

**`demo-board.tsx`, `story-panel.tsx` and `raycast-callout.tsx` must have no
`"use client"` anywhere in their import graph.** They run at build time and
ship as HTML.

Three specific imports would break it, all of them tempting:

- `components/board/board-column.tsx` → `createLabel` → **Dexie on the
  marketing page**.
- `components/board/todo-card.tsx` → `useSortable()` → cannot render outside a
  `DndContext` at all.
- `components/ui/tooltip.tsx` or `ui/checkbox.tsx` → Base UI → **a hydration
  runtime to explain four icons that never move.** `demo-tooltip.tsx` exists
  for exactly this; it trades away collision detection, which costs nothing
  because every one of these sits mid-page in a fixed-width card.
- `next/image` in the coda → **`image-component.js` opens with `"use client"`**
  → a hydration runtime to render two static screenshots. It would also
  optimize nothing, since the static export sets
  `images: { unoptimized: true }`. Pre-sized WebP with explicit `width`/
  `height` is better on both counts, and the `no-img-element` lint rule is
  disabled at that one line with the reason written next to it.

`demo-board.test.ts` enforces it by reading source and following aliased
imports one level down. It is a unit test rather than a build test on purpose —
what regresses cheaply is the import list, and that is right there in the diff.
The same shape as `lib/desktop/bundle-assets.test.ts`, for the same reason.

`card-travel.tsx` is the sanctioned exception: it is `"use client"` *and* it
renders no copy of its own — the card arrives as `children`. The moment it
imports `StoryPanel`, the page ships that markup twice. The test asserts it
does not.

### Fidelity: the demo must not advertise what the product cannot do

A hero that shows a feature a new user cannot reproduce is the worst kind of
marketing bug — it only looks wrong *after* someone signs up. Two rules, both
tested:

- **Screenshots are captures, not mockups.** The coda's two images are the
  shipped Raycast extension, counts and all. A hand-drawn "screenshot" of an
  interface nobody built breaks this rule in the way that is hardest to
  notice. The coda also links to `/docs` rather than to the extension: it is
  private to one organization today, so a store link would send most readers
  somewhere they cannot install from — which is the same failure wearing a
  different hat.
- **No colored labels.** All five `createLabel` call sites pass a name and
  nothing else; there is no label color picker in Faite. `todo-row-parts.tsx`
  *will* tint a label that has one, so a hex on a demo label renders
  convincingly and lies. `DemoLabel.color` stays in the type because a future
  picker might, but the test fails on any hex in a label definition — in
  `demo-board.tsx` **and** in `story-panel.tsx`, because the same hex was
  written out a second time by hand there and fixing only the first left a
  tinted pill on the most looked-at card on the page.
- **Column names come from `SEED_LISTS`.** A visitor who signs up should
  recognize the board they were shown. Invented column names are a smaller lie
  than colored labels and the same kind.

Lists and tabs are **exempt** — `list-info-dialog.tsx` and `tab-info-dialog.tsx`
both mount a real `ColorPicker`, so a column accent is a genuine feature.

---

## 5. The travel

`card-travel.tsx` flies a third copy of the card from the hero row into the
resting panel. FLIP, with both ends **measured live every frame** — neither
real card is ever moved. A resize, a font swap, or a reflow mid-scroll
self-corrects on the next frame instead of stranding the card at coordinates
that were true a second ago.

Four things interpolate: translate, width, list height, and opacity. The
geometry runs over the middle band only, so the copy is exactly on the origin
during the fade-in and exactly on the target during the fade-out — `FADE = 0.12`
at each end. The crossfades are what let the two real cards differ; the board
row and the panel header are not the same markup, so a hard handoff would pop.

It does nothing at all under `md`, under reduced motion, or with no JavaScript.
That is not a degraded mode: `story-panel.tsx` renders a **true static state**
from `doneThrough`, so the fallback is the page with one flourish missing.

**Why it costs layout, deliberately.** Width and height reflow one small
subtree once a frame. The cheaper alternative is `scale()`, and it is wrong: it
would zoom the title from 14px to 35px and blur every glyph on the way, when
what the card actually does is *widen and unfold*.

---

## 6. The ticks

`story-ticks.tsx` renders `null`. It reads `[data-story] > div` — the same box
`RoomStage` measures — and from a rAF loop toggles `data-done` on both copies
of the card, rewrites the sub-task count, and drives the rolling line's date
and "In overflow" pill.

Reading the same element as the camera is the point: a second, independently
derived notion of "how far in are we" is exactly how the room ends up framing
the plant while a different line ticks.

**The threshold is `floor(t * n + 1 - TICK_AT)` — i.e. `+ 0.6` — and both
other candidates are wrong:**

- `floor(t * n)` ticks a beat only once you have scrolled clear of it, so the
  card lags a section behind the copy. Measured at t = 0.99 it still read 5/6:
  the page ended on an unfinished plan, which is the opposite of the point.
- `+ 0.5` puts the threshold exactly on the beat's center and makes the result
  knife-edge. Sampled at the six exact centers it returned 0,1,2,3,5,6 instead
  of 1–6, because rounding the scroll target to a whole pixel landed a hair
  under the boundary four times out of six.

---

## 7. Recipe: adding or changing a beat

1. **Find the evidence first.** Every printed claim traces to a
   `docs/RESEARCH.md` §2 row, quoted per §6 there. Check §4 before printing any
   number — no Zeigarnik, no "21 days", no 41%/42%. §5 sources are not
   publishable. If there is no row, the beat does not ship.
2. **Add the row** to `STORY_BEATS`, with a new member of the `BeatFocus`
   union if it frames a new object.
3. **Add the framing.** `FRAMINGS` is a `Record<BeatFocus, Framing>`, so
   `tsc` will demand it. Respect the zoom band — `room-camera.test.ts` fails
   past 135.
4. **Decide what the room does**, and put it in `beat-animations.ts` as a pure
   function of beat-local `u`. Land the act by `COMMIT_AT`. See
   [SCENE.md §11](SCENE.md) for the four rules and the curves.
5. **Apply it thinly** in `room-scene.tsx` — lerp toward whatever the state
   function says; no logic there.
6. **Run the tests.** `beat-animations.test.ts` and `room-camera.test.ts` both
   iterate `STORY_BEATS`, and `marketing-pages.spec.ts` asserts every beat
   renders its headline, citation and sub-task and that the card finishes at
   `STORY_BEATS.length`.

Changing only a to-do's **wording** is step 2 alone — but re-read the claim
next to it. "Painter comes Saturday, 9:00am" became "Change paint color", and
the date and time had to move into the card's own badges rather than being
dropped, because the beat's whole claim is *a date and a time, not just a
date*. A shortened title that loses the time puts the copy and the citation
back out of step.

---

## 8. Known limits

None of these is a bug today. Each is a thing that will surprise the next
person, and none has a test.

- **Only the first beat with `subtaskRolls` animates.** `story-ticks.tsx` does
  `STORY_BEATS.find(b => b.subtaskRolls)`; a second rolling beat is silently
  ignored.
- **Roll state comes from `plantStateAt`, whoever rolls.** The timing follows
  `rollBeat.focus` correctly, but the roll count and the overflow flag are read
  from the plant's curve by name. Moving `subtaskRolls` to another beat works;
  it just still reads the plant's function.
- **A beat with no state function is silent.** Nothing fails if you add a beat
  and never make the room do anything — the camera will dutifully frame an
  object that does nothing while the card ticks a line off. That is precisely
  the lie §3 exists to prevent, and it is the one case type-checking cannot
  catch.
- **`demo-board.tsx` is a hand-written echo.** If `todo-card.tsx` or
  `board-column.tsx` is restyled, nothing breaks and nothing tells you — the
  demo just quietly stops looking like the product. Give it a look.
- **No collision detection on `DemoTooltip`.** Fine where they are; if one
  moves near a viewport edge, that is the moment to reach for the real one.

---

## 9. Traps

1. **Two `lerp` forms, both correct, do not unify them.**
   `room-camera.ts` uses `(1 - t) * a + t * b`, because `a + (b - a) * t` does
   *not* land exactly on `b` at `t = 1` — the camera settled ~1e-16 short and
   never quite arrived. `card-travel.ts` uses the other form on purpose: it
   interpolates pixel positions that are fully faded out at both ends, so
   exactness there buys nothing and the cheaper form reads better.

2. **`prefers-reduced-motion` cannot be tested with Playwright's
   `reducedMotion` option here.** It is set and `matchMedia` still reads
   `false`, so the canvas mounts and the fallback is never rendered — the test
   fails on the one assertion that matters while everything before it passes,
   which looks exactly like a flake. Use `javaScriptEnabled: false`: it holds
   `RoomStage` at its `enabled: false` initial state, is not emulated media,
   and tests a stronger claim. Full write-up in `.ai/lessons.md`.

3. **`playwright-report/` breaks `npm run verify` if you lint it.** It bundles
   a vendored CodeMirror, ~257 errors. Already in `globalIgnores`; it cost
   three debugging detours before it went there. Do not remove it.

4. **The hero board is cropped, not scaled.** `w-6xl max-w-none` inside an
   `overflow-hidden` box. A desktop board shrunk to fit a narrow viewport is a
   picture of something broken, not a smaller picture of the truth.

5. **After `npm run verify`, `.next` serves the app shell — where `/` is a
   redirect to `/board` and nothing else.** `verify` ends with `build:static`,
   which builds the Capacitor/Tauri target and leaves it there. Run
   `next start` against that and every homepage spec fails at once, with the
   board's welcome dialog in the failure snapshot and headings "not found",
   because the page under test never rendered. It cost a full misleading e2e
   run. Bare `npm run build` first — it is the first line of the local-CI
   recipe in [WORKFLOW.md §4](WORKFLOW.md) for this reason.

6. **`page.tsx`'s two inline scripts must survive any refactor.**
   `redirectIfKnownDevice` (returning visitors) and the `NEXT_PUBLIC_APP_SHELL`
   branch (the Tauri/Capacitor target, which gets *only* a redirect). The
   second is what keeps three.js out of the desktop bundle, and `next/dynamic`
   alone does not do it — see `lib/desktop/bundle-assets.test.ts` and the
   865 KB entry in `.ai/lessons.md`.

---

## 10. What is tested

| Claim | Test |
|---|---|
| The hero board is server-rendered HTML | `marketing-pages.spec.ts` |
| Nothing in the two Server Components imports a client component | `demo-board.test.ts` |
| No demo label carries a color; columns come from `SEED_LISTS` | `demo-board.test.ts` |
| `story-ticks`/`card-travel` never write React state | `demo-board.test.ts` |
| Every beat renders headline, citation and sub-task | `marketing-pages.spec.ts` |
| Each beat ticks its own line, ending at `STORY_BEATS.length` | `marketing-pages.spec.ts` |
| The story reads with no JavaScript at all | `marketing-pages.spec.ts` |
| The card flies from the board into the panel | `marketing-pages.spec.ts` |
| The room's act lands before the tick | `beat-animations.test.ts` |
| Every beat's `focus` resolves to a framing, inside the zoom band | `room-camera.test.ts` |
| `/spike-3d` is gone | `marketing-pages.spec.ts` |
| No British spelling in any string literal or JSX text | `lib/spelling.test.ts` |

`marketing-pages.spec.ts` runs under the `desktop` and `phone-iphone`
projects — the `npm run e2e:ci` gate pair. See [E2E.md §8](E2E.md).

**Not tested:** that the room's animation is *good*, that the camera frames
what a human would call the object, or that the copy matches the room. Those
are [SCENE.md §9](SCENE.md)'s job — look at it.
