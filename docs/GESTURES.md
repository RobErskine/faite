# Gestures — the phone pager's touch model

How `PhoneBoard` (`src/components/board/phone-board.tsx`, mobile plan P3)
turns raw touch input into page-swiping and per-column scrolling, and why it's
built on native CSS scroll-snap rather than a JS carousel library. See
`docs/MOBILE.md` §9–10 for the surrounding plan and phase history; this
document is the mechanism, not the roadmap.

## Why scroll-snap, not a gesture library (Embla, `@use-gesture`, …)

dnd-kit caches each droppable's rect at drag start and corrects it by the
scroll delta of its scrollable ancestors as the drag continues (see
`board.tsx`'s comment on why Overflow/Backlog are pinned flex siblings rather
than `position: sticky`). That correction reads a real `scrollLeft`. A
transform-based carousel replaces `scrollLeft` with a CSS `transform`, so it
gives dnd-kit nothing to correct against — every droppable rect inside the
track would silently drift out of sync with the pointer mid-drag. Scroll-snap
keeps a real scrolling container: `scrollLeft` still moves, dnd-kit's
correction still applies, `use-day-track.ts`'s existing pager math
(`jumpBy`/`jumpToIndex`/`jumpToToday`, `computeAnchorIndex`) keeps working
unmodified, and the browser does fling physics at native refresh rate for
free.

## The two utilities

`src/app/globals.css`:

- **`column-track-pager`** — the horizontal pager itself (`dayTrackRef` /
  `listTrackRef`). `overflow-x: auto`, `scroll-snap-type: x mandatory`,
  `scroll-snap-stop: always`, and `--column-min`/`--column-max: 100%` — the
  same vars `BoardColumn`'s root already reads on desktop, so making a column
  exactly one page wide needed no component change at all. Suspends snapping
  entirely (`[data-dragging] { scroll-snap-type: none }`) for the duration of
  a drag, set directly from `ui.dragging` — a snap point fighting dnd-kit's
  own scroll compensation near a page edge would otherwise read as the column
  yanking back under the cursor.
- **`pager-column`** — each page (`BoardColumn`'s root, via its `className`
  passthrough). `scroll-snap-align: start` is what makes it the snap target;
  `overflow-y: auto` / `overflow-x: hidden` is its own independent vertical
  scroll for content taller than the viewport.

## Axis routing: no explicit `touch-action` on the column

The original design gave the track `touch-action: pan-x` and each column
`touch-action: pan-y`, on the theory of "one axis owned per nesting level."
That's wrong for this specific shape, and it was a real, confirmed bug for
several days of P3 development before being caught: **every column fills the
entire page**, so there is no "track background" region left for a touch to
start on instead — every touch on the pager necessarily lands inside a
`pager-column`. Chromium resolves a touch's native panning axis from the
touch-action of the element it actually starts on, not a clean intersection
with an ancestor's differing axis — so a column's own `pan-y` silently wins
over the track's `pan-x` for every touch, and horizontal swipe-to-page never
engages at all, anywhere. Confirmed with real touch input (`Input.
dispatchTouchEvent` via CDP, not a synthetic/untrusted event — see
`e2e/support/touch.ts`) on both portrait phone projects before diagnosing it,
and again after the fix.

The fix: `pager-column` sets **no** `touch-action` at all — left at the
property's own default (`auto`). With that, the browser's ordinary
scroll-chaining routes each touch correctly on its own: a vertical drag goes
to the column (the nearest ancestor that's scrollable in Y, since the column
is `overflow-x: hidden` and never contests X), and a horizontal drag falls
through to the track (the nearest ancestor scrollable in X, since the column
never scrolls X at all). For two ancestors that genuinely own disjoint axes
like these, that native routing already does the right thing — explicit
`touch-action` restriction is only needed to *preempt* native scrolling in
favor of JS (which is exactly what dnd-kit's `TouchSensor` does for a drag,
and why `drag-grip.tsx` has none of its own: it isn't a scroll container at
all). Regression-covered by `e2e/touch-smoke.spec.ts`'s "a horizontal swipe
scrolls the day track" test on `phone-iphone`/`phone-pixel`.

The track itself keeps `touch-action: pan-x` — harmless (it's only ever
touched indirectly through a column, and a touch starting on its own
background, if one ever existed, should scroll it horizontally and nothing
else) and left in place rather than also stripped, since removing it
demonstrated no behavior change either way during the fix.

## Why no swipe-actions on cards (swipe-to-complete/delete)

dnd-kit's `TouchSensor` (`{delay: 250, tolerance: 8}` on coarse pointers,
`board.tsx` sensors) already owns horizontal gesture priority on every row —
and the browser commits a touch's scroll axis at the first `touchmove`,
before any JS gets a chance to decide otherwise. A card can't cede X to the
pager for scrolling AND claim X for a swipe action; whichever wins, the other
breaks. The P4 row `⋯` action sheet is the replacement, and arguably better
for a *destructive* action regardless: discoverable, keyboard/AT-accessible,
and testable in a way a hidden gesture isn't.

## Why no vertical swipe between Days and Lists

Any vertical *paging* gesture on the pager either steals the primary reading
scroll axis (a column's own content is vertically scrollable — a swipe meant
to switch views is indistinguishable from one meant to scroll) or fires only
at a scroll boundary (misfires constantly, and is unreachable on a column
short enough to never hit one). The bottom segmented control
(`phone-bottom-bar.tsx`, Days | Lists) replaces it — vertical always means
"scroll," at every level, with no exception a user has to learn. See
`docs/MOBILE.md` §9 for the full decision record, including the correction
that this switch is local per-device state rather than a synced setting.
