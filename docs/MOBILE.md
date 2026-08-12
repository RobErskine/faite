# Mobile responsiveness — working document

**Self-contained handoff.** Everything needed to continue the mobile work on
Faite without re-deriving it. This is a living document, updated as each
phase ships — read the phase table below before assuming anything past P0
exists yet.

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
phone   width < 640    — new IA, not yet built (P3)
tablet  640–1023       — existing two-half board, touch-tuned (P1)
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
actually shown for it). Not yet consumed anywhere — **P0 ships this hook
unwired, on purpose.** Branching the actual layout on it is P2/P3's job,
after the `board.tsx` extraction gives it a seam to branch from without
duplicating `DndContext`/`Hotkeys`/every sheet mount (that duplication is
exactly what breaks dnd-kit's id-keyed droppable maps — see `board.tsx`
around the `DaySheet` mount for the documented precedent).

**`?layout=phone` (or `tablet`/`desktop`) on any URL forces the layout
class**, read once per navigation. This is the difference between testing
the phone shell in a desktop browser tab and needing a physical device for
every check — use it liberally once P3 exists. Tested in
`src/lib/use-viewport.test.ts`; not yet covered in `e2e/` for the same reason
the hook itself isn't — there's no DOM effect to observe until something
consumes it.

## 3. Hover-affordance variants

```css
@custom-variant hoverable (@media (hover: hover) and (pointer: fine));
@custom-variant touch     (@media (hover: none));
@custom-variant coarse    (@media (pointer: coarse));
```

(`src/app/globals.css`, beside `@custom-variant dark`.) Plain `hover:` is the
wrong tool for a "reveal on interaction" control: on most touch browsers the
first tap satisfies `:hover` until the next tap elsewhere, so
`hover:opacity-100` half-shows on touch rather than just showing normally.
`hoverable`/`touch` are mutually exclusive by construction, so a control can
say `touch:opacity-100` unconditionally without also fighting a real hover
state on desktop.

**Not yet applied anywhere.** P1 is the five hover-only reveals that need it
— the card drag grip (`todo-card.tsx`), the tab info button and tab drag grip
(`tab-strip.tsx` — the grip is currently the *only* way to reorder tabs, so
this one is a real gap, not polish), the rail collapse chevron
(`rail-collapse-button.tsx`), and the column subtitle (`board-column.tsx`).

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

**Not yet consumed anywhere.** There's no bottom bar, sticky quick-add, or
phone-specific chrome to pad yet — that's P3. Landscape will matter more
than it looks: on a notched phone the pager's first/last column sits under
the notch, so the eventual consumer needs `--safe-left`/`--safe-right` on the
shell too, not just top/bottom.

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

| Phase | Scope | Status |
|---|---|---|
| **P-1** | Playwright E2E harness — desktop/tablet/phone projects, Tier A structural contract, Tier B real touch via CDP | **Shipped.** See docs/E2E.md. |
| **P0** | `viewport` export, safe-area vars, manifest + placeholder icons, `@custom-variant`s, `use-viewport.ts` + `?layout=` override, `overscroll-none`, static-export entry fix | **Shipped.** This document. |
| **P1** | Touch remediation on the *existing* desktop layout — the 5 hover-only reveals, `buttonVariants` coarse sizes, checkbox/switch/select hit areas, coarse-tuned dnd-kit sensors, resize-handle hit areas | Not started |
| **P2** | Extract `board.tsx` (2574 lines, no `board.test.tsx`) into `use-board-data`/`use-board-ui-state`/`use-board-actions` + a `BoardContext` seam | Not started |
| **P3** | The phone shell — scroll-snap pager, bottom segmented control (Days / Lists), compact header, sticky quick-add, `useViewport()` finally consumed | Not started |
| **P4** | Adaptive overlays — `adaptive-sheet.tsx` swapping `Sheet`↔`Drawer` by layout, full-screen command palette on phone, row `⋯` action sheet (there is no per-row delete today — only in the TodoSheet footer and ⌘K) | Not started |
| **P5** | `mention-menu.tsx` → `@floating-ui/react`, BlockNote-on-touch audit | Not started |
| **P6** | Optional: `Drawer.SwipeArea` swipe-up-for-Lists, `Drawer.Indent` | Not started |

## 9. Decisions already made (don't relitigate)

- **Vertical "swipe up/down between lists/day views" was declined as
  literally requested.** Any vertical *paging* gesture either steals the
  primary reading scroll axis (unusable) or fires only at scroll boundaries
  (misfires constantly, unreachable on a short column). Landed on: a bottom
  segmented control (Days | Lists) — maps onto the existing
  `settings.splitCollapsed` enum, no new schema — with vertical meaning
  "scroll" everywhere, always. `Drawer.SwipeArea` swipe-up-from-the-bar is a
  P6 *optional* layer on top, not a replacement.
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
  card can't cede X to a pager AND claim it for a swipe action. P4's row `⋯`
  action sheet is the replacement: strictly better for a *destructive*
  action anyway (discoverable, keyboard/AT-accessible, testable) than a
  hidden gesture would have been.
- **Read-time layout overrides only, never write-time.** Phone needs
  `visibleDays: 1`, weekends expanded, rails collapsed — resolve these in
  whatever data hook reads `settings`, never via `mutateSettings`. Settings
  sync across devices; a write-time override means opening the app on a
  phone once permanently mangles the desktop layout on every other device.
  No type-system trick catches this — it's a review checklist item.
