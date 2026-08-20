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

**What CI starts is not `next dev`.** It builds and serves a production
bundle (`E2E_SERVER="npx next start -p 3000"`), which measured ~2x faster per
test and strictly more reliable — see §9. Everything above still describes
the local path, which is unchanged.

## 6. Running it

```bash
npm run e2e:ci           # the PR gate — desktop + phone-iphone (53 tests)
npm run e2e              # the full matrix — all five projects (89 tests)
npm run e2e -- --project=desktop
npm run e2e -- --project=phone-iphone e2e/touch-smoke.spec.ts
npm run e2e:ui            # Playwright's interactive UI mode
npm run e2e:report        # open the last HTML report
```

**`e2e:ci` is what a PR actually runs; `e2e` is the optional deeper pass.**
The full matrix is no longer run on every PR — see §8.5. Run it locally
before opening a large feature PR, or trigger the `CI` workflow by hand
(`workflow_dispatch`, `e2e: full`) to get it on a runner. Everything else
about the two is identical; `e2e:ci` differs only by two `--project` flags.

For exact parity with CI, `CI=1 npm run e2e:ci` — but note `CI=1` also flips
`reuseExistingServer` to false, so Playwright will try to start its own
`next dev` and fail if you already have one on port 3000 (§5). Stop your dev
server first, or leave `CI` unset and accept 3 workers' worth of difference.

**Deliberately not part of `npm run verify`.** Verify already runs two Next
builds and takes minutes; browser launch and a live dev server add real time
on top, and a dev shouldn't pay that cost on every local `verify` run. CI
runs it as a separate, parallel job (`.github/workflows/ci.yml`) instead.

## 7. Adding a spec

- New structural assertions about the *existing* desktop layout go in
  `desktop-layout.spec.ts`.
- New behavior that should hold on every viewport goes in
  `core-flows.spec.ts`.
- New gesture coverage goes in `touch-smoke.spec.ts`. **Which projects a
  spec runs under is decided in `playwright.config.ts`, not in the spec** —
  add the file to the `testMatch` list of each project that should run it
  (§8). A brand-new spec that nobody adds to a `testMatch` runs under *zero*
  projects and passes silently; `e2e/config-coverage.test.ts` fails `npm
  test` if you forget, so you find out in `verify` in seconds rather than
  never.
  - Register it in every project that *should* run it, not just the two the
    PR gate happens to use. The gate narrows by `--project` at invocation
    (§8.5) and never by editing `testMatch`, which is what keeps "doesn't
    run on a PR" and "doesn't run at all" different things — only the second
    is a bug, and only the second is what `config-coverage.test.ts` guards. Specs used to carry a `test.beforeEach` + `test.skip(project.name
  !== ...)` guard instead; those are gone, because a guard only skips a run
  Playwright has already scheduled, started and resolved fixtures for.
  - If you do need a conditional skip *within* a project — the way
    `touch-smoke.spec.ts` skips its reorder test on
    `phone-iphone-landscape` (§3) — it still has to be
    `test.beforeEach` + `test.skip(condition, reason)`, and **not** a
    top-level `test.skip(callback)`, which silently no-ops: `testInfo`
    isn't populated outside a test/hook body, so the condition never
    actually skips anything and every project just runs the file. Easy to
    get wrong once and hard to notice, since the failure mode is "tests ran
    when they shouldn't have," not an error.
- When P0–P4 of the mobile plan land and the desktop-only layout gets a real
  phone/tablet shell, this suite's job changes from "prove nothing broke" to
  "prove the new shell actually works" — update the Tier A assertions in
  place to describe the new structure per breakpoint, rather than writing a
  parallel suite next to the old one.

---

## 8. What runs where, and what was traded away for time (EI-187)

The suite used to take ~10 minutes of an ~11 minute CI job. It now takes
about three. Most of that came from deleting work rather than parallelising
it, which means **coverage was genuinely given up** — this section is the
record of exactly what, so the trade can be re-argued later with the same
information that was used to make it.

### 8.1 The matrix

`playwright.config.ts` gives every project a `testMatch`. That is the single
source of truth; there are no project guards inside specs any more (§7).

| Spec | desktop | tablet-ipad-mini | phone-iphone | phone-iphone-landscape | phone-pixel |
| -- | :-: | :-: | :-: | :-: | :-: |
| `foundations` (2) | ● | | | | |
| `marketing-pages` (11) | ● | | | | |
| `desktop-layout` (5) | ● | | | | |
| `keyboard-drag` (7) | ● | | | | |
| `multi-drag` (5) | ● | | | | |
| `completion-tooltip` (6) | ● | | | | |
| `core-flows` (5) | ● | ● | ● | ● | ● |
| `reminders` (4) | ● | | ● | | |
| `overdrive` (8) | ● | | ● | ● | |
| `touch-affordances` (3) | | ● | ● | ● | ● |
| `touch-smoke` (2) | | | ● | ● | ● |

**111 tests.** Before, every project ran every spec — 36 x 5 = **180 runs**,
of which 56 immediately hit a skip guard and exited.

This table is what `npm run e2e` runs, and it is the *full* matrix. A pull
request runs a subset of it: the **`desktop` and `phone-iphone` columns
only** (75 tests, `npm run e2e:ci`). The other three columns are deferred to
a local run or a `workflow_dispatch` — see §8.5 for why those two, and what
deferring the rest gives up.

### 8.2 Why each cell is empty

- **`foundations` on one project.** It asserts the `<head>` viewport meta tag
  and fetches the PWA manifest. Neither can vary by emulated viewport, so
  the other four runs were four identical assertions about one static file.
  Nothing was traded here; the coverage is unchanged.
- **`marketing-pages` on `desktop` only** (the S milestone, EI-212). Static
  content — title, description, canonical, `og:site_name`, footer, the
  legal placeholder notice, `sitemap.xml`/`robots.txt` — none of which
  varies by viewport. Table-driven off `SITE_PAGES` (`src/lib/site.ts`), the
  same table `sitemap.ts` and `MarketingFooter` read, so a page added there
  without a passing test here is a build failure, not a silent gap.
- **`desktop-layout`, `keyboard-drag` on `desktop` only.** Unchanged from
  before — these were already guarded to `desktop`. They are just declared
  in the config now instead of skipped at runtime.
- **`multi-drag` on `desktop` only** (EI-194). Cmd+click has no touch
  equivalent, and the gesture is desktop-scoped by design. Nothing is traded:
  there is no behaviour here for another viewport to have.
- **`completion-tooltip` on `desktop` only** (EI-196). It needs CDP mouse
  input, which is Chromium-only, and a hover has no meaning on a touch
  project. Note this spec leads with a deliberate **CONTROL** test that hovers
  a known-good tooltip — without it, "the tooltip did not open" is ambiguous
  between a broken app and a harness that cannot open any tooltip, and that
  ambiguity has already cost a debugging session once. If the control ever
  fails, every other assertion in that file is meaningless.
- **`touch-affordances` off `desktop`, `touch-smoke` off desktop/tablet.**
  Also unchanged: `pointer: coarse` doesn't exist on desktop, and CDP touch
  dispatch is only wired for the `phone-*` projects (§3).
- **`core-flows` everywhere.** Untouched on purpose. This is the
  cross-viewport behaviour contract — it is the one suite whose whole reason
  for existing is running on all five, and it stays that way.
- **`reminders` on `desktop` + `phone-iphone` only.** *Traded away:* tablet,
  landscape and Pixel. This spec asserts what got written to the store and
  which badge renders on the card; the only viewport-sensitive step in it is
  `switchToLists()`, and `core-flows` already exercises that helper on all
  five projects. **Risk accepted:** a reminder badge that renders correctly
  on `phone-iphone` but clips at iPad Mini's width would not be caught here.
  Tier A asserts structure, not pixels, so it would most likely not have
  been caught before either.
- **`overdrive` on `desktop` + `phone-iphone` + `phone-iphone-landscape`.**
  *Traded away:* tablet and Pixel. Kept landscape deliberately, even though
  it is the most expensive of the three, because a 393px-tall viewport is
  where a full-screen overlay actually breaks and this is the only project
  that exercises one. **Risk accepted:** an Overdrive regression specific to
  iPad Mini's width or to Pixel's device-pixel-ratio.

### 8.3 The one change that wasn't a coverage trade

`overdrive.spec.ts` was **56% of the entire suite** (465s of 830s CPU),
because `seedOverflow()` — called nine times per project — ended with
`await expect(toast).toBeHidden({ timeout: 10_000 })`, waiting out sonner's
~4s auto-dismiss. That wait existed for a real reason: on the narrow phone
viewports the toast (bottom-right) lands directly over the Overdrive button
(bottom-left rail), and the next click in the test would race it.

`support/fixtures.ts` now sets `pointer-events: none` on the toast layer, so
a toast cannot intercept a click at all and there is nothing left to wait
for. No spec asserts that a toast is clickable — they read toasts for their
text and nothing more — so this cost no coverage. It took `overdrive` from
~93s per project to ~54s on its own.

If you ever *do* need to assert tapping a toast, remove that `addStyleTag`
for that spec rather than deleting it globally.

### 8.4 The CI job

- **Runs in `mcr.microsoft.com/playwright:v<version>-noble`.** Not for
  speed — for the hang. The old job cached the browser binaries but still
  ran `npx playwright install-deps chromium` (i.e. `apt`) on *every* run,
  and that call stalled twice during the Aug 17–18 merge queue: 22 min on
  `ei-183`, 35 min on `ei-62`, both green on re-run, neither related to any
  test. The image ships Chromium and its OS deps, so there is no `apt` call
  left to stall and no browser cache to maintain.
- **The image tag has to match `@playwright/test` in `package-lock.json`.**
  Bumping Playwright without bumping the tag means the baked-in browsers
  aren't the ones that version expects. The `Playwright version matches the
  container` step fails the job immediately with the tag to change, rather
  than letting it fail confusingly later.
- **`workers: 3`, not 2 and not 4.** `ubuntu-latest` has 4 vCPUs and the
  config had hardcoded 2, leaving half the machine idle. 4 was measured and
  is *worse*: a worker per core leaves nothing for the `next dev` server all
  of them share, and that server compiles routes on demand and answers every
  navigation. At 4 it starved — cold `/board` compiles took 7.9s and
  `dev-seed.ts`'s ten sequential IndexedDB writes stopped fitting in
  `expect`'s 5s default, failing all 24 `overdrive` tests. **This rationale
  is now weaker than when it was written** — the server CI starves is the one
  §9 replaced with a production build, so 4 may well be safe today. It has
  not been re-measured; that is a live follow-up, not a settled decision. 3 leaves the
  server a core.
- **`webServer.url` points at `/board`, not `/`.** Playwright polls that URL
  until it answers and only then starts the run, so whichever route it names
  is the one compiled during startup, for free, while the runner is
  otherwise idle. Pointed at `/`, it warmed the marketing page and left
  `/board` — the route *every* test in this suite loads — to be compiled by
  whichever tests reached it first, concurrently, out of their own 30s
  budgets.
- **Not sharded** — and this reverses an earlier decision, so the reasoning
  matters. Sharding's only product is wall clock on the blocking path, and
  it buys that by paying the fixed setup (container pull + `npm ci` +
  `next dev` boot, ~140s) once *per shard*. Three shards took the job to
  ~4m30 — but `verify` runs alongside at ~4m30 regardless, so the PR was
  never going to finish sooner than that. The shards bought nothing on the
  critical path and cost ~10 billed runner-minutes per PR run. That was the
  wrong currency: this repo is private on a Free plan (2,000 min/month), and
  landing EI-187 itself burned ~125 of them across eight pushes. Iteration
  count is the multiplier, so the cost of *one* run is what matters.
- **`e2e/config-coverage.test.ts` guards the matrix.** Declaring coverage in
  the config is what made the suite fast, but it moved the failure mode from
  "slow" to "quiet": a spec absent from every `testMatch` runs nowhere and
  reports nothing. That test runs in `npm test` — so in `verify`, in
  milliseconds — and fails if any spec is unregistered, if a `testMatch`
  names a file that no longer exists (a rename silently stops a spec
  running), or if a project has no `testMatch` at all and has quietly gone
  back to running everything.
- **The HTML report is written directly, and uploaded only on failure.**
  With one job there are no per-shard blobs to stitch, so the `blob`
  reporter and the whole `e2e-report` merge job are gone; the reporter is
  `html` with `open: "never"` (explicitly, because this runs in a container
  as `--user 1001`, where opening a browser hangs rather than errors).
  Uploaded on failure only — a green report is 14 days of metered artifact
  storage nobody opens.
- **Timeouts exist now**, and scale with the path: `timeout-minutes: 10` on
  the gate job / 8 on its E2E step, 20 / 15 on a `workflow_dispatch` full
  run, 15 on `verify`. There were none at all before, so a stall ran to
  GitHub's 6-hour default — which is exactly how one hung `apt` step burned
  **360 billed minutes**, 18% of a month's allowance, on a docs-only commit.
- **`concurrency` with `cancel-in-progress` on PRs.** Pushing three times to
  a PR used to leave three full runs racing for runners when only the last
  one's result would ever be read. `main` is exempt: each push there gets
  its own group, so a merge is never cancelled by the merge behind it.
- **CI is skipped for docs-only commits** (`paths-ignore: **/*.md`, `.ai/**`,
  `LICENSE`) and **e2e is skipped on merges to `main`**. A `pull_request`
  run tests the *merge result*, not the branch tip, so re-running e2e on
  `main` bought a second copy of an answer already given minutes earlier.
  `verify` still runs there — it is the one that catches a semantic conflict,
  where two PRs pass alone and break together.

### 8.5 Mandatory vs optional — what a PR actually runs

The full matrix stopped running on every PR. `npm run e2e:ci` — the **gate** —
runs `--project=desktop --project=phone-iphone`, **53 of the 89 tests**.

**Why that pair, and not just `desktop`.** `resolveLayout()`
(`src/lib/use-viewport.ts`) is `< 640` phone, `< 1024` tablet, `>= 1024`
desktop. Against the device widths in `playwright.config.ts`:

| project | width | shell rendered |
| -- | -- | -- |
| `desktop` | 1440 | `DesktopBoard` |
| `tablet-ipad-mini` | 768 | `DesktopBoard` |
| `phone-iphone-landscape` | 852 | `DesktopBoard` |
| **`phone-iphone`** | **393** | **`PhoneBoard`** |
| `phone-pixel` | 412 | `PhoneBoard` |

Only a sub-640 project ever renders `PhoneBoard`. So desktop + phone-iphone
is the *cheapest pair that exercises both shells*; a desktop-only gate would
give `phone-board.tsx` and `phone-bottom-bar.tsx` zero PR-time execution, and
would leave `touch-affordances.spec.ts` and `touch-smoke.spec.ts` — plus the
whole CDP touch pipeline in `support/touch.ts` — running under no project at
all. Every spec file still executes under the gate.

**Deferred to the full matrix** (viewport redundancy; no spec is lost):

- `tablet-ipad-mini` — the only check that the two-half board still fits
  below 1024px (`src/lib/split.ts`'s `SPLIT_MIN` arithmetic).
- `phone-iphone-landscape` — the 393px-*tall* case, the one viewport short
  enough to break a full-screen overlay (`overdrive`).
- `phone-pixel` — a second phone DPR/UA. `PhoneBoard` itself is covered by
  `phone-iphone`, so this is the cheapest of the three to defer.

**Where the full matrix still runs:** `npm run e2e` locally, and the `CI`
workflow's `workflow_dispatch` with `e2e: full`. Run it before opening a
large feature PR, or before a release.

**The rule:** the gate narrows by `--project` **at invocation**, never by
editing `testMatch`. Widening it is a one-line change to the `e2e:ci` script
in `package.json` — `playwright.config.ts` is not involved, which is what
keeps `config-coverage.test.ts` meaningful (§8.4).

If a third project ever earns its ~1.5 billed minutes, add
`phone-iphone-landscape` (the overlay case) rather than the tablet.

**Arithmetic** (GitHub bills each job rounded *up* to the minute; Linux 1×):

| path | e2e billed | + `verify` | total | wall clock |
| -- | -- | -- | -- | -- |
| 3-shard full matrix (before) | 15 | 5 | **20** | ~4m30 |
| gate (now) | 7 | 5 | **12** | ~6m |
| merge to `main` | 0 | 5 | **5** | ~4m30 |
| `workflow_dispatch`, full | 9 | — | **9** | ~8m |

The gate is ~1m30 *slower* in wall clock than the 3-shard run it replaces.
That is the deliberate trade: un-sharding costs latency and buys back ~8
billed minutes per PR run, and with iteration counts of 5–8 pushes on a real
feature branch, the per-run cost is what compounds. If wall clock ever
matters more, sharding the gate 2× costs 3 more billed minutes.

---

## 9. Why CI runs a production build, and dev doesn't

`webServer.command` in `playwright.config.ts` is `next dev` locally and
`npx next start` in CI, against a real `next build`. That split reverses §5's
original "dev everywhere for startup speed" — §5 was right that dev *starts*
faster, but the cost is not paid at startup. It is paid on every single
`page.goto("/board")`, once per test.

### The measurement

Same commit, same machine, one server at a time, over the 53-test gate
(`npm run e2e:ci`, 5 workers):

| server | total CPU | min | median | max | failures |
| -- | -- | -- | -- | -- | -- |
| `next dev` | **487s** | 2.9s | 8.1s | 26.1s | **5 of 53** |
| `next start` | **225s** | 1.2s | 3.6s | 13.4s | **0 of 53** |

**54% less CPU, and 55% faster per test.** Repeated three times against dev
(613s / 536s / 487s) and twice against production (264s / 225s); the ratio
held every time.

### The reliability difference matters more than the speed

All five dev-mode failures were the same thing — the fixture timing out after
15s waiting for `Continue without an account`, i.e. the board never finishing
its boot. That is not a flaky assertion; it is several workers hitting an
on-demand-compiling dev server at once and starving it. It is the same
failure that forced `workers` from 4 down to 3 (§8.4), and the same one that
made `webServer.url` point at `/board` so the route is compiled during
startup rather than by the first tests to arrive.

Production serves pre-built chunks and simply does not have the failure mode.
Zero failures across both runs, including the CDP touch specs.

Testing the production bundle is also **higher fidelity** — it is what
actually ships. The reason §5 could pick dev freely still holds (`/board` is
`ssr:false` and reads only IndexedDB, so dev and prod render identically),
which is exactly why this swap is safe.

### Why local stays on `next dev`

`reuseExistingServer: !CI` means a developer already running `npm run dev`
has their server reused — that is the whole point locally. Requiring
`npm run build` before every local e2e run would cost more developer time
than the seconds it saves. The two paths differ, deliberately, in the same
way `workers` and `retries` already do.

To reproduce CI's setup locally:

```bash
npm run build
npx next start -p 3001 &
E2E_PORT=3001 npm run e2e:ci
```

`E2E_PORT` and `E2E_SERVER` exist for exactly this.

### Cost

The build costs ~35s in the e2e job (with `.next/cache` restored) and buys
back roughly half of the test time, so it pays for itself on the gate and
pays more on a full `workflow_dispatch` run.

**Open follow-up:** `workers` was capped at 3 because the *dev* server needed
a core. With production that constraint is weaker, so 4 may now be safe and
would cut wall clock further. Not changed here — one variable at a time.
