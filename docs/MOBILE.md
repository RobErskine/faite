# Mobile responsiveness — working document

**Self-contained handoff.** Everything needed to continue the mobile work on
Faite without re-deriving it. This is a living document, updated as each
phase ships — read the phase table below before assuming anything past M0
exists yet.

> **Numbering.** This document's phases are **M-1…M6** — a separate axis from
> the product roadmap's **P0…P7** (`docs/ARCHITECTURE.md` §7). They are not a
> continuation of each other and they do not line up: M3 is the phone shell,
> P3 was sync v0. A bare "P<n>" anywhere in this file means the roadmap phase.

---

## 1. Why, and why now

Faite is desktop-only today: zero responsive prefixes across the board
(`board.tsx`, `board-column.tsx`, `todo-card.tsx`, `app-header.tsx`,
`date-nav.tsx`, `tab-strip.tsx`). The goal is a genuinely good phone/tablet
experience with gesture navigation — swipe to page between days and lists —
not a squeezed-down copy of the desktop board.

**The two-half board is arithmetically impossible on a phone**, not just
cramped. The Backlog rail is 218px + padding — 64% of a 390px viewport,
permanently. `src/lib/split.ts`'s `SPLIT_MIN` is 200px *per half*, against
maybe 700px of content height after chrome; in landscape (a phone is ~390px
*tall*) the split can't fit at all and `use-split-resize.ts` silently bails
to its default ratio every time. Confirmed by measurement in
`e2e/touch-smoke.spec.ts` — see docs/E2E.md §3. Tablet is fine as-is (iPad
mini portrait at 744px fits rail + two columns).

## 2. Layout classes

```
phone   width < 640    — new IA: PhoneBoard, a scroll-snap pager (M3)
tablet  640–1023       — existing two-half board, touch-tuned (M1)
desktop width >= 1024  — unchanged
```

Width decides the class, not pointer type — a touchscreen laptop should
still get the desktop board, and a phone with a Bluetooth mouse is still a
phone. Pointer/hover are a second, independent axis (`coarse`/`hover` below):
a device can be `desktop` + `coarse` (a touchscreen laptop) just as easily as
`phone` + `coarse`.

### `useViewport()` — `src/lib/use-viewport.ts`

```ts
const { layout, coarse, hover } = useViewport();
// layout: "phone" | "tablet" | "desktop"
// coarse: pointer: coarse    — drives hit-target sizing, dnd-kit sensor tuning
// hover:  hover: hover       — drives whether a hover-only control needs a
//                              touch-visible fallback
```

`useSyncExternalStore` over `matchMedia` + `resize`, server snapshot fixed at
desktop/fine/hoverable (correct for every route this app ships outside the
board, and `/board` itself is `ssr:false` so the server snapshot is never
actually shown for it).

**`coarse` is consumed as of M1** — `board.tsx` reads it to tune
`TouchSensor`'s `activationConstraint` and gate the haptic nudge on drag
start (see `docs/DRAG-AND-DROP.md` §4.9b). That's a behavior parameter, not a
render branch, so it didn't need the `board.tsx` extraction to be safe: no
duplicate `DndContext`/sheet mounts, no risk of the id-keyed-droppable-map
bug. **`layout` is still unconsumed** — branching the actual render tree on
it is still M2/M3's job, after the extraction gives it a seam to branch from.

**`?layout=phone` (or `tablet`/`desktop`) on any URL forces the layout
class**, read once per navigation. This is the difference between testing
the phone shell in a desktop browser tab and needing a physical device for
every check — use it liberally once M3 exists. Tested in
`src/lib/use-viewport.test.ts`; still not covered in `e2e/` — `coarse` being
consumed doesn't change that `layout` itself still drives no DOM effect to
observe.

## 3. Hover-affordance and coarse-pointer variants

**Corrected in M1** — M0 originally defined three custom variants
(`hoverable`, `touch`, `coarse`); two were redundant and have been removed.
Compiling this stylesheet and reading Tailwind's own output settled it:
v4 already wraps `hover:`/`group-hover:` in `@media (hover: hover)` (so a
tap on a `hover: none` device genuinely never triggers them — no "sticky
until the next tap elsewhere" workaround needed, which *was* true pre-v4 and
is what the original comment here assumed), and `pointer-coarse:`/
`pointer-fine:` have been native since v4.1. Only the gap those two don't
cover needed a custom variant:

```css
@custom-variant touch (@media (hover: none));
```

(`src/app/globals.css`, beside `@custom-variant dark`.) Nothing native
provides "show this unconditionally on a device that can never hover" — the
fallback a `group-hover:`-revealed control needs on touch. Use native
`pointer-coarse:`/`pointer-fine:` for hit-target sizing (M1 uses this
throughout) and leave every existing `hover:`/`group-hover:` alone; they
were already correct.

**One tailwind-merge caveat, inherited from `drag-grip.tsx`'s own comment on
this exact class family:** `tailwind-merge` does not recognize that
`-inset-3` (shorthand) and `-inset-x-3`/`-inset-y-2` (axis-specific) target
the same property, so mixing the two forms across a base class and a variant
override leaves the loser silently in the DOM rather than deduped away.
Always use the axis-specific form for any inset-based hit-area expansion,
matching what's already there.

M1 applies `touch:opacity-100` to the four hover-only reveals that break
discoverability on touch without it: the card drag grip (`todo-card.tsx`),
the tab info button and tab drag grip (`tab-strip.tsx` — the grip is
currently the *only* way to reorder tabs, so this one is a real gap, not
polish), and the rail collapse chevron (`rail-collapse-button.tsx`). A fifth
candidate — the list-column drag grip's `group-hover/column:text-muted-
foreground` in `board-column.tsx` — turned out not to need one: unlike the
other four, it's a color intensification on an already-visible-at-rest
element (base state is `text-muted-foreground/30`, not `opacity-0`), so
there's nothing invisible for touch to miss.

## 4. Safe-area insets

```css
--safe-top:    env(safe-area-inset-top, 0px);
--safe-right:  env(safe-area-inset-right, 0px);
--safe-bottom: env(safe-area-inset-bottom, 0px);
--safe-left:   env(safe-area-inset-left, 0px);
```

(`src/app/globals.css` `:root`.) Named vars, not raw `env()` at each call
site — a future Capacitor build (P7) can override these in one place if its
WebView ever reports 0 under some `contentInset` config, tests can stub them
without real hardware, and the intent is stated once. **Resolve to 0 without
`viewportFit: "cover"`** (see §5) — that's the one required piece, not these
vars, and it's easy to add the vars and forget the export that makes them
non-zero.

**`--safe-bottom` is consumed as of M3** — `PhoneBottomBar`'s root carries
`pb-(--safe-bottom)`, so the Days/Lists switch clears a home-indicator bar
rather than sitting under it. **`--safe-top`/`--safe-left`/`--safe-right`
are still unconsumed.** `AppHeader` (compact or not) is a fixed `h-12` with
no top padding, and the pager's shell has none on the sides — on a notched
phone in landscape, where the pager's first/last column sits directly under
the notch, that's a real gap, not a hypothetical. Worth picking up whenever
mobile work resumes, but low urgency: portrait (the primary orientation)
only needs `--safe-top`, and even that is cosmetic (content tucks under the
status bar, doesn't get clipped) rather than broken.

## 5. Viewport meta + PWA

`src/app/layout.tsx` exports `viewport` (width/initialScale, `viewportFit:
"cover"`, `interactiveWidget: "resizes-content"`, light/dark `themeColor`)
and extends `metadata` with `appleWebApp` (`capable: true`,
`statusBarStyle: "black-translucent"`). `black-translucent` is what makes
content extend under the status bar when added to the home screen — the
actual payoff for `viewportFit: "cover"`; without both, every
`env(safe-area-inset-*)` is 0 even on hardware with a notch.

Deliberately **no** `maximumScale`/`userScalable: false` — disabling
pinch-zoom is an accessibility regression, fails a Lighthouse audit, and iOS
silently ignores it anyway.

`src/app/manifest.ts` (Next's file-convention route) — `display:
"standalone"`, `start_url: "/board"` (not `"/"`: a device that already has
the app installed should reopen straight into it, not back onto the
marketing pitch), icons at 192/512 + a maskable 512. **Icons are
placeholders** (`public/icon-{192,512,maskable-512}.png` — a dark square
with a bold white "F", generated with ImageMagick) pending real artwork;
swap the files, not `manifest.ts`, once branded icons exist.

**`export const dynamic = "force-static"` is required on `manifest.ts` under
`output: "export"`** (`npm run build:static`) — without it the static export
build fails outright with "not configured on route… with output: export".
Easy to miss because the regular Workers build (`npm run build`) works fine
without it; only the Capacitor guard catches the omission.

No service worker yet, deliberately — the app is already local-first on
IndexedDB, so offline *data* already works without one; a SW only buys the
offline shell, and it's a known footgun under `capacitor://localhost`
(P7). Add it after Capacitor, not before.

Covered by `e2e/foundations.spec.ts` (Tier A, all projects): the viewport
meta tag's content string, and that the manifest resolves with the right
`start_url`/`display`/icon set.

## 6. Static-export entry point

`docs/ARCHITECTURE.md` used to record a gap: the static export
(`output: "export"`, the Capacitor target) opened on the marketing page, not
`/board` — there's no marketplace listing to land a stranger on inside a
WebView, only a device that already has the app installed.

Fixed: `npm run build:static` (`package.json`) now also sets
`NEXT_PUBLIC_APP_SHELL=1`. `src/app/page.tsx` checks
`process.env.NEXT_PUBLIC_APP_SHELL === "1"` and, when set, returns *only* an
unconditional `window.location.replace("/board")` script — no marketing
markup at all — instead of its normal conditional
`redirectIfKnownDevice` (which only redirects a browser that's used the
board before). `next/navigation`'s `redirect()` doesn't fit here: this has
to run in the browser ahead of hydration, the same technique
`redirectIfKnownDevice` already uses, not during static generation (there's
no server at runtime in a WebView to have run it on).

**Verifying this is subtler than it looks.** Grepping the exported
`index.html` for marketing copy is not proof of a bug — React serializes the
*entire* component tree as RSC "flight" payload JSON for client-side
prefetch caching, so marketing text can appear deep in that payload even
when the actually-rendered, actually-visible HTML is just the redirect
script. The real test is loading the exported HTML in a browser and checking
where it ends up — `npx serve .next-static` + Playwright confirmed `/` lands
on `/board`. If this ever needs re-verifying, do it that way, not with a
text search.

## 7. `overscroll-behavior`

The board shell (`board.tsx`, the `<div className="flex h-dvh flex-col …">`
wrapping everything) carries `overscroll-none` — kills iOS's whole-page
rubber-band and Android's pull-to-refresh at the shell boundary. Scoped to
the board specifically, not `html`: the marketing page has no internal
scroll containers competing with the page scroll, so it has nothing to
protect and no reason to opt out of the platform default.

## 8. Phase status

**Paused after M3, deliberately.** M0–M3 are merged and deployed — the app is
genuinely usable on phone and tablet, including gesture paging. M4 onward
(adaptive overlays, mobile-only QOL affordances like a lists overview or a
which-days-have-tasks view) is intentionally on hold while the desktop core
experience is still being iterated on. Reasoning: those features are
navigation *over* the core IA, so they're the most exposed to churn if the
core changes; two more layout-consumers of a still-moving core also raises
the tax described in the plan's Risk 6 ("two layouts means every future board
feature costs ~1.5×"). Resume once desktop is stable. Anything that's purely
additive inside `phone-board.tsx`/`phone-bottom-bar.tsx` and needs no new
shared state (see `use-board-data.ts`/`use-board-ui-state.ts`) is cheap
enough to be an exception — evaluate case by case rather than blanket-holding
everything.

| Phase | Scope | Status |
|---|---|---|
| **M-1** | Playwright E2E harness — desktop/tablet/phone projects, Tier A structural contract, Tier B real touch via CDP | **Shipped.** See docs/E2E.md. |
| **M0** | `viewport` export, safe-area vars, manifest + placeholder icons, `@custom-variant`s, `use-viewport.ts` + `?layout=` override, `overscroll-none`, static-export entry fix | **Shipped.** This document. |
| **M1** | Touch remediation on the *existing* desktop layout — the 4 hover-only reveals, `buttonVariants`/`SelectTrigger`/tab-pill coarse sizes, checkbox/resize-handle `::after` hit areas, coarse-tuned dnd-kit sensors + haptic, guard test | **Shipped.** §3, §9, `docs/DRAG-AND-DROP.md` §4.9b. |
| **M2** | Extract `board.tsx` (2574 lines, no `board.test.tsx`) into `use-board-data`/`use-board-ui-state`/`use-board-actions` + a `DesktopBoard` seam | **Shipped.** See docs/ARCHITECTURE.md §4. |
| **M3** | The phone shell — scroll-snap pager, bottom segmented control (Days / Lists), compact header, `layout` (the other half of `useViewport()`) finally consumed | **Shipped.** §10. |
| **M4** | Adaptive overlays — `adaptive-sheet.tsx` swapping `Sheet`↔`Drawer` by layout, full-screen command palette on phone, row `⋯` action sheet (there is no per-row delete today — only in the TodoSheet footer and ⌘K) | Not started |
| **M5** | `mention-menu.tsx` → `@floating-ui/react`, BlockNote-on-touch audit | Not started |
| **M6** | Optional: `Drawer.SwipeArea` swipe-up-for-Lists, `Drawer.Indent` | Not started |

## 9. Decisions already made (don't relitigate)

- **Vertical "swipe up/down between lists/day views" was declined as
  literally requested.** Any vertical *paging* gesture either steals the
  primary reading scroll axis (unusable) or fires only at scroll boundaries
  (misfires constantly, unreachable on a short column). Landed on: a bottom
  segmented control (Days | Lists, `phone-bottom-bar.tsx`) — with vertical
  meaning "scroll" everywhere, always. `Drawer.SwipeArea` swipe-up-from-the-bar
  is a M6 *optional* layer on top, not a replacement.
  **Correction from the original plan:** this switch is a plain local
  `useState` (`phoneView` in `use-board-ui-state.ts`), NOT
  `settings.splitCollapsed` as originally sketched — `splitCollapsed` is in
  `SETTINGS_SYNCED_FIELDS` (`src/lib/sync/wire.ts`), so wiring the phone
  switch to it would sync which pager a phone is showing to every other
  device on the account, including desktops that have no such concept. Local,
  unsynced, per-device state is correct here.
- **Horizontal paging is CSS scroll-snap, not a JS gesture library.**
  dnd-kit corrects each droppable's rect by the scroll delta of its
  scrollable ancestors (this is why Overflow/Backlog are pinned flex
  siblings rather than `position: sticky` — see `board.tsx`). A
  transform-based pager (Embla, `@use-gesture`) gives dnd-kit nothing to
  correct against; scroll-snap keeps a real `scrollLeft`, so
  `use-day-track.ts`'s existing pager math (`jumpBy`/`jumpToIndex`,
  `computeAnchorIndex`) keeps working unmodified.
- **No swipe-to-complete/delete on cards.** dnd-kit's `TouchSensor`
  (`{delay: 250, tolerance: 8}`, `board.tsx` sensors) already owns
  horizontal touch gesture priority on every row, and the browser commits
  the scroll axis at `touchmove` before any JS gets to decide otherwise — a
  card can't cede X to a pager AND claim it for a swipe action. M4's row `⋯`
  action sheet is the replacement: strictly better for a *destructive*
  action anyway (discoverable, keyboard/AT-accessible, testable) than a
  hidden gesture would have been.
- **Read-time layout overrides only, never write-time.** Phone needs
  `visibleDays: 1`, weekends expanded, rails collapsed — resolve these in
  whatever data hook reads `settings`, never via `mutateSettings`. Settings
  sync across devices; a write-time override means opening the app on a
  phone once permanently mangles the desktop layout on every other device.
  No type-system trick catches this — it's a review checklist item.

## 10. M3 — the phone shell

`phone-board.tsx` renders exactly one of two full-width scroll-snap pagers at
a time (`ui.phoneView`, §9): a Days pager (Overflow, then each day column)
and a Lists pager (Backlog, then each list column, then "create list"),
switched via `PhoneBottomBar`. Weekend collapse is force-disabled on phone
(`use-board-data.ts`: `collapsingWeekends = layout !== "phone" &&
settings?.showWeekends === false`) — a 40px weekend strip as a full pager page
is unusable. `DndContext`'s `autoScroll` is off on phone
(`use-board-actions.ts`) — incremental auto-scroll against a mandatory snap
type judders every frame; cross-page moves go through the sheet instead.

**Overflow as page −1.** On desktop/tablet Overflow is a pinned flex sibling
outside the scrolling track; on phone there's no "outside" to pin it to, so
it's simply the Days pager's first page. `use-day-track.ts` gained an
`indexOffset` option (1 on phone, 0 elsewhere) so `anchorIndex` stays "0 =
today" for `jumpBy`/`jumpToIndex`/`jumpToToday` regardless of Overflow's extra
page — every read/write of `scrollLeft` in that hook translates through
`indexOffset` at exactly two points (the scroll listener's anchor
computation, the jump effect's `scrollTo`).

**Bug found and fixed: `useEffect`/`useLayoutEffect` deps don't see a ref
attach.** A `React.RefObject`'s `.current` going from `null` to an element
does not itself re-trigger effects with an empty/unrelated dep array — and
`Board`'s loading gate means `dayTrackRef`/`listTrackRef` can still be `null`
on an effect's first run. This silently broke the pager's initial
scroll-to-today alignment (it opened on Overflow instead), and turned out to
be a **pre-existing bug**, not phone-specific — verified by reproducing the
same failure on desktop's date-range label after a programmatic scroll.
Fixed with a shared `whenTrackReady(trackRef, setup)` helper in
`use-day-track.ts` (polls via `requestAnimationFrame` until the ref resolves,
then runs `setup` and returns its cleanup) — applied to all three track-ref
effects in that file, not just the new alignment one.

**Bug found and fixed: `pager-column`'s `touch-action: pan-y` broke
horizontal swipe-paging everywhere.** The original axis-ownership design
(§9's scroll-snap decision, docs/GESTURES.md) gave the track `pan-x` and each
column `pan-y`, intending a clean split. In practice every column fills the
whole page — there is no "track background" left for a touch to start on
instead — so *every* touch on the pager lands inside a `pan-y` element, and
Chromium honors that column's own restriction over the ancestor track's
`pan-x` for that touch: horizontal swipe-to-page never engaged, on real touch
input, on either portrait phone project. Confirmed live via CDP touch
dispatch (`e2e/support/touch.ts`) before and after the fix. Fixed by removing
`touch-action: pan-y` from `@utility pager-column` (`globals.css`) entirely —
left at its default (`auto`), the browser's own scroll-chaining routes a
vertical drag to the column (the nearest Y-scrollable ancestor, since it's
`overflow-x: hidden` and never contests X) and a horizontal drag to the track
(the nearest X-scrollable ancestor, since the column never scrolls X at all).
For genuinely disjoint-axis ancestors like these two, unrestricted panning
resolves the routing correctly on its own — explicit `touch-action` per level
is only needed where JS (dnd-kit) needs to preempt native scrolling, not here.
Regression-covered by `e2e/touch-smoke.spec.ts`'s "a horizontal swipe scrolls
the day track" on `phone-iphone`/`phone-pixel`.

**E2E**: `e2e/support/fixtures.ts`'s bootstrap wait switched from the
"Backlog" region to "Overflow" — the only region both pagers ever render
unconditionally (Backlog only exists in the Lists pager, which isn't the
default view). `e2e/support/phone.ts` adds `switchToLists()`, a no-op on
tablet/desktop, used by any assertion in `core-flows.spec.ts`,
`touch-affordances.spec.ts`, and `touch-smoke.spec.ts` that needs Backlog or
the tab strip. `AppHeader`'s compact (icon-only) palette trigger has no
`aria-keyshortcuts` the way the wide desktop field does — `core-flows.spec.ts`
now matches on the shared "search or run a command" wording instead of that
attribute so the same test reaches both shapes.
