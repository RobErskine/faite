# End-to-end tests — working document

**Self-contained handoff.** Everything needed to continue E2E work on Faite
without re-deriving it. Read this before adding a spec; several choices here
look arbitrary but were arrived at by hitting the alternative first.

---

## 1. Why this exists

Written as **M-1** of the mobile-responsive plan, before any mobile UI work,
specifically so the P2 extraction of `board.tsx` (2574 lines, no
`board.test.tsx`) has a real regression net instead of just `tsc`. It runs
against **today's unmodified desktop-only layout** and is meant to keep
passing — unchanged in what it asserts, just re-pointed at new DOM where the
mobile work changes structure — through every later phase.

Three tiers, deliberately unequal in cost and value:

- **Tier A — structural contract** (`desktop-layout.spec.ts`). DOM presence,
  bounding boxes, computed relationships — not pixels. Cheap, durable, and
  where nearly all the value is. `core-flows.spec.ts` is Tier A too, in the
  sense that it asserts behavior rather than gestures, but runs on every
  project rather than `desktop` only (see file header).
- **Tier B — real gestures** (`touch-smoke.spec.ts`). Genuine touch input via
  CDP — see §3.
- **Tier C — pixel snapshots.** Not implemented. Baselines are OS-specific
  (macOS local vs. Linux CI font stack), so they'd need Playwright's own
  Docker image or CI-only runs to be stable — worst effort:value ratio of the
  three. Revisit only if a visual regression actually slips through Tier A.

## 2. Determinism

The board is date-relative — column headers are literally "Tuesday", "Aug
11" — so every test needs the same "today" or assertions rot by the next
morning. `support/fixtures.ts` freezes it with **`page.clock.setFixedTime()`,
not `page.clock.install()`**. This distinction cost real debugging time and
is worth restating: `install()` replaces the page's real timers with a
virtual clock that only advances when a test explicitly asks it to, and
React's scheduler (plus Next's own chunk loading) depends on real
`setTimeout` ticking — with `install()`, the app hangs forever on the
`dynamic()` "Loading your board…" fallback, no error, nothing in the
console. `setFixedTime()` pins `Date.now()`/`new Date()` only and leaves
every other timer running normally.

No app source was changed to make seeding work. `useBootstrap()`
(`src/lib/store/hooks.ts`) already seeds a Backlog list, four starter lists,
and a default tab into any empty IndexedDB on boot, and Playwright gives
every test its own fresh, isolated browser context by default — so "fresh
store" and "seeded board" fall out of the app's own first-run behaviour for
free. Content-bearing tests seed further through the real UI (typing into
quick-add, pressing Enter) rather than reaching into Dexie, which is both
more realistic and requires zero test-only hooks in app code.

**`WelcomeDialog`** (`src/components/auth/welcome-dialog.tsx`) opens over
every fresh board — every test is a first-ever boot as far as the app can
tell — and steals pointer events from everything behind it. The fixture
dismisses it before doing anything else. If a test starts failing with
errors that point at an unrelated element "intercepting pointer events" or a
click silently not registering, check this first.

## 3. Tier B: gestures, and why they need CDP

`locator.dispatchEvent()` does **not** work for touch gestures here.
Playwright's own docs note it does not set `Event.isTrusted`, and an
untrusted `touchmove` does not drive native scrolling or dnd-kit's
`TouchSensor` (`board.tsx` sensors) — the event fires, the browser does
nothing with it, and the test would pass or fail based on nothing real.

`support/touch.ts` instead uses `page.context().newCDPSession(page)` and
`Input.dispatchTouchEvent` — a real, OS-level input event as far as the
renderer is concerned. This is **Chromium-only**, which is why every project
in `playwright.config.ts` forces `defaultBrowserType: "chromium"` even where
the device preset (iPhone, iPad) would otherwise default to WebKit. The
trade: real Safari-engine coverage is sacrificed for the ability to test
gestures at all. Given the board has zero gesture code today and this suite
exists to verify gesture code as it lands, that trade is the right one; if
WebKit-specific rendering bugs ever become the concern, add a WebKit-only
visual project rather than un-forcing this.

`swipe()` and `longPressDrag()` share one shape: CDP `touchStart`, N
`touchMove` steps toward the target, `touchEnd`. The difference is
`longPressDrag`'s pause before the first move — it has to clear dnd-kit's
`TouchSensor` `activationConstraint.delay` (250ms, `board.tsx` sensors) or
the gesture reads as a flick/scroll rather than a drag pickup.

**These tests are the first time either gesture has been exercised against a
real touch input pipeline in this repo.** `docs/DRAG-AND-DROP.md` §7 item 4
had stood open as "touch drag, never verified on a real device" since the
`TouchSensor` was configured; `touch-smoke.spec.ts` closes that.

**Known gap:** the long-press reorder test is skipped on
`phone-iphone-landscape`. Measured: at 852x393 the Backlog rail is ~97px
tall (`src/lib/split.ts`'s `SPLIT_MIN` is 200px *per half*, which cannot fit
in a 393px-tall viewport after header/DateNav/split-handle chrome — the
split is already in the degenerate state the mobile plan's Decision 1
flags). Two todo rows barely fit at all, and the reorder failed there
consistently across a generous drop target and multiple repeats — not a
locator bug, but the two-half board genuinely not working in that
orientation on today's layout. That's real signal, not a harness bug: it's
exactly the case the mobile plan's M3 phone shell has to fix, and
re-enabling this assertion once it exists is one way to prove it did.

## 4. Selector conventions

- Prefer `getByRole` with the accessible name the app already computes
  (`aria-label`, heading text) over any test-only attribute. Every column is
  `<section aria-label={title}>`, giving `region` roles for free
  (`board-column.tsx`). No `data-testid` exists anywhere in this suite and
  none should be added while an accessible name is available instead —
  accessible-name selectors double as a coverage check that the app is
  actually accessible.
- **Watch for aria-label substring collisions.** A todo card's drag grip
  carries `aria-label="Drag to reschedule or reorder <title>"`
  (`todo-card.tsx`), which Playwright's default (substring, case-insensitive)
  name match also resolves for a plain `{ name: title }` query against the
  title button. Use `exact: true` on any todo-title locator.
- **Watch for repeating accessible names.** The day track pre-renders well
  past one week (`DEFAULT_RENDERED_DAYS`, `board.tsx`), so a weekday name
  like "Tuesday" recurs every 7 columns. `.first()` is always this week's,
  since columns render in date order starting today.
- Match a changing accessible name with a regex, not the pre-change string —
  `Checkbox`'s `aria-label` flips between "Mark … done" and "Mark … not
  done" (`todo-card.tsx`) the instant a click lands, so a locator captured
  before the click stops matching anything by the time an assertion runs.
- `detectPlatform()` (`src/lib/keyboard.ts`) resolves the "mod" hotkey
  modifier by sniffing `navigator.platform`/`userAgent` — **not** the host
  OS running the test. Every project here reports a non-mac UA
  (`devices["Desktop Chrome"]` hardcodes Windows regardless of the machine
  running it; the phone presets report iOS/Android), so "mod" is Ctrl in
  every project, unconditionally. Don't branch on `process.platform`.

## 5. Local server, and the one config choice that isn't obvious

`playwright.config.ts` points at `http://localhost:3000` with
`reuseExistingServer: !CI`, **not** a dedicated port. Two reasons, both
non-negotiable:

1. Next 16 + Turbopack refuses to start a second `next dev` in the same
   project directory *at all* — it locks per project, not per port, so
   picking a different port doesn't avoid the conflict if a dev server is
   already running.
2. **Use `localhost`, never `127.0.0.1`.** Next dev's HMR WebSocket does an
   Origin check the IP literal fails (it isn't `localhost` and isn't in
   `next.config.ts`'s `allowedDevOrigins`), which silently breaks the
   handshake — and Turbopack's client blocks module loading on that socket,
   so the app hangs forever on `dynamic()`'s "Loading your board…" fallback
   with no error surfaced anywhere except a console WebSocket warning. This
   cost real debugging time; if this suite ever mysteriously hangs again on
   first load, check this before anything else.

In CI, nothing is listening on 3000 yet, so Playwright starts its own — the
`command` bypasses the `dev` npm script's `concurrently` + agentation
companion process on purpose, since a second process that can fail
independently is a CI flake source neither Playwright nor this app needs.

## 6. Running it

```bash
npm run e2e              # headless, all projects
npm run e2e -- --project=desktop
npm run e2e -- --project=phone-iphone e2e/touch-smoke.spec.ts
npm run e2e:ui            # Playwright's interactive UI mode
npm run e2e:report        # open the last HTML report
```

**Deliberately not part of `npm run verify`.** Verify already runs two Next
builds and takes minutes; browser launch and a live dev server add real time
on top, and a dev shouldn't pay that cost on every local `verify` run. CI
runs it as a separate, parallel job (`.github/workflows/ci.yml`) instead.

## 7. Adding a spec

- New structural assertions about the *existing* desktop layout go in
  `desktop-layout.spec.ts`.
- New behavior that should hold on every viewport goes in
  `core-flows.spec.ts`.
- New gesture coverage goes in `touch-smoke.spec.ts`, guarded to
  `phone-*` projects the same way the existing two tests are
  (`test.beforeEach` + `test.skip(condition, reason)` — **not** a top-level
  `test.skip(callback)`, which silently no-ops: `testInfo` isn't populated
  outside a test/hook body, so the condition never actually skips anything
  and every project just runs the file. This is easy to get wrong once and
  hard to notice, since the failure mode is "tests ran when they shouldn't
  have," not an error.)
- When P0–P4 of the mobile plan land and the desktop-only layout gets a real
  phone/tablet shell, this suite's job changes from "prove nothing broke" to
  "prove the new shell actually works" — update the Tier A assertions in
  place to describe the new structure per breakpoint, rather than writing a
  parallel suite next to the old one.
