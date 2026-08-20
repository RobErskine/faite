import { defineConfig, devices } from "@playwright/test";

/**
 * The E2E regression gate — desktop, tablet and phone viewports against ONE
 * app tree, ahead of the mobile-responsive work (see docs/E2E.md).
 *
 * `/board` is `ssr:false` (`src/app/board/page.tsx`) and reads only from
 * IndexedDB, so `next dev` renders it identically to a production build —
 * dev is used *locally* for startup speed — CI runs against a production
 * build instead, which measured ~2x faster per test and strictly more
 * reliable (docs/E2E.md §9). Bypasses the `dev` npm script's
 * `concurrently` + agentation companion process on purpose: a second process
 * that can fail independently is a CI flake source neither Playwright nor
 * this app needs.
 *
 * Port 3000, not a dedicated E2E port: Next 16 + Turbopack refuses to start a
 * second `next dev` in the same project directory at ALL (it locks per
 * project, not per port — attempting a second instance on any other port
 * fails with "Another next dev server is already running"). So rather than
 * fight that lock, `reuseExistingServer` targets whatever's already on 3000
 * locally and only spawns its own (in CI, where nothing is running yet).
 */
// `E2E_PORT` exists so this suite can be pointed at a second server without
// editing the config — which is how the dev-vs-production comparison in §9
// of docs/E2E.md was measured, and how it can be re-measured later. 3000
// stays the default for the `reuseExistingServer` path below.
const PORT = Number(process.env.E2E_PORT ?? 3000);
// "localhost", not the equivalent "127.0.0.1": Next dev's HMR WebSocket does
// an Origin check the IP literal fails (it isn't "localhost" and isn't in
// next.config.ts's allowedDevOrigins), which silently breaks the handshake —
// and Turbopack's client blocks module loading on that socket, so the whole
// app hangs forever on the `dynamic()` "Loading your board…" fallback with
// no error surfaced anywhere except a WebSocket console warning.
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Which specs run under which device project — the single source of truth,
 * and the main reason this suite is ~3 minutes rather than ~10 (EI-187).
 *
 * Before this existed, every project ran every spec: 36 tests x 5 projects =
 * 180 runs, of which 56 were immediately thrown away by a
 * `test.skip(project.name !== ...)` guard inside the spec. Those guards were
 * correct about the coverage they wanted and wrong about where to say it —
 * Playwright still had to schedule a worker slot, resolve fixtures and start
 * a test for each one. Declaring it here means the runs are never created.
 *
 * The full rationale for each line, and the coverage deliberately traded
 * away for time, is written down in docs/E2E.md §8 — read that before
 * widening or narrowing any of these lists.
 */
const SPECS = {
  foundations: "**/foundations.spec.ts",
  desktopLayout: "**/desktop-layout.spec.ts",
  keyboardDrag: "**/keyboard-drag.spec.ts",
  multiDrag: "**/multi-drag.spec.ts",
  completionTooltip: "**/completion-tooltip.spec.ts",
  coreFlows: "**/core-flows.spec.ts",
  reminders: "**/reminders.spec.ts",
  overdrive: "**/overdrive.spec.ts",
  touchAffordances: "**/touch-affordances.spec.ts",
  touchSmoke: "**/touch-smoke.spec.ts",
} as const;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 3, measured, not 2 (too idle) and not 4 (too greedy) — EI-187.
  //
  // `ubuntu-latest` has 4 vCPUs and this was hardcoded to 2, leaving half the
  // machine unused. But 4 is a worker per core with nothing left for the
  // `next dev` server those workers all share, and that server is not a
  // spectator here: it compiles routes on demand and answers every
  // navigation. Measured at 4, it starved — cold `/board` compiles took 7.9s
  // (four workers hitting an uncompiled route at once) and
  // `dev-seed.ts`'s ten sequential IndexedDB writes stopped fitting in
  // `expect`'s 5s default, failing all 24 `overdrive` tests outright.
  // 3 leaves a core for the server. Locally, Playwright's own default (cpu
  // count) still applies — a dev machine has cores to spare.
  workers: process.env.CI ? 3 : undefined,
  // `html` again, not `blob`. The e2e job stopped being sharded, so one
  // runner sees the whole run and can write a complete report directly —
  // which retired both the blob reporter and the `e2e-report` job that
  // existed only to stitch shards back together.
  //
  // `open: "never"` explicitly rather than relying on the reporter's
  // `on-failure` default: this runs inside a container as `--user 1001`,
  // where trying to open a browser is a hang rather than an error.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: {
    // CI overrides this to `npx next start` against a real production build
    // (see .github/workflows/ci.yml). Measured, same code, same machine, one
    // server at a time, over the 53-test gate:
    //
    //     next dev     487s CPU   median 8.1s/test   5 of 53 failed
    //     next start   225s CPU   median 3.6s/test   0 of 53 failed
    //
    // Dev mode was not merely slower — it was *unreliable*. All five failures
    // were the fixture timing out waiting for `Continue without an account`,
    // i.e. the board never finishing its boot while several workers hit an
    // on-demand-compiling dev server at once. That is the same starvation
    // that forced `workers` down from 4 to 3 (see above). Production serves
    // pre-built chunks and simply does not have the failure mode.
    //
    // Local runs keep `next dev`: `reuseExistingServer` means a dev already
    // running `npm run dev` gets reused, which is the whole point locally,
    // and requiring a build before every local e2e run would be a worse
    // trade than the seconds it saves. docs/E2E.md §9.
    command: process.env.E2E_SERVER ?? `npx next dev -p ${PORT}`,
    // `/board`, not `/`. Playwright polls this URL until it answers and only
    // then starts the run — so whatever it points at is the route that gets
    // compiled during startup, for free, while the runner is otherwise idle.
    // Pointed at `/`, that warmed the marketing page and left `/board`
    // uncompiled, so the first N tests each paid a ~7.9s Turbopack compile
    // out of their own 30s budget, concurrently, and timed out (EI-187).
    // Every test in this suite lands on `/board`; warming it is warming the
    // suite.
    url: `${BASE_URL}/board`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      // The only project that runs the pointer/keyboard-bound specs, and the
      // one that carries `foundations` — that spec asserts `<head>` and the
      // manifest, which no viewport can change, so one project is a complete
      // check of it and five were four redundant copies.
      testMatch: [
        SPECS.foundations,
        SPECS.desktopLayout,
        SPECS.keyboardDrag,
        SPECS.multiDrag,
        SPECS.completionTooltip,
        SPECS.coreFlows,
        SPECS.reminders,
        SPECS.overdrive,
      ],
    },
    // Every touch/tablet project below forces `defaultBrowserType: "chromium"`
    // over whatever the device preset ships (iPhone/iPad presets default to
    // WebKit — the only engine real iOS can run). Tier B (support/touch.ts)
    // needs `Input.dispatchTouchEvent`, a CDP-only capability WebKit doesn't
    // expose, so every project a touch-smoke test can run under has to be
    // Chromium regardless of which device it otherwise emulates. Tier A/core
    // flows don't touch browser-engine-specific behavior, so this trade
    // costs real Safari-engine coverage but not correctness of what's tested.
    {
      name: "tablet-ipad-mini",
      use: { ...devices["iPad Mini"], defaultBrowserType: "chromium" },
      // Tablet renders the same two-half layout as desktop, just narrower,
      // so its distinct value is the coarse-pointer affordances plus the
      // cross-viewport behaviour contract — not a third copy of the feature
      // specs desktop and phone already cover.
      testMatch: [SPECS.coreFlows, SPECS.touchAffordances],
    },
    {
      name: "phone-iphone",
      use: { ...devices["iPhone 15"], defaultBrowserType: "chromium" },
      // The reference phone: `PhoneBoard`'s two-pager shell is the layout
      // most different from desktop, so it is the second project to carry
      // the full feature specs.
      testMatch: [
        SPECS.coreFlows,
        SPECS.touchAffordances,
        SPECS.touchSmoke,
        SPECS.reminders,
        SPECS.overdrive,
      ],
    },
    {
      name: "phone-iphone-landscape",
      use: { ...devices["iPhone 15 landscape"], defaultBrowserType: "chromium" },
      // Keeps `overdrive` because a 393px-tall viewport is where a
      // full-screen overlay actually breaks, and this is the only project
      // that exercises one. Drops `reminders`: that spec's assertions are
      // about what got written to the store and which badge renders, neither
      // of which turns on orientation.
      testMatch: [SPECS.coreFlows, SPECS.touchAffordances, SPECS.touchSmoke, SPECS.overdrive],
    },
    {
      name: "phone-pixel",
      use: { ...devices["Pixel 7"] },
      // The Android profile — a second portrait phone at a different DPR and
      // UA. Carries the viewport-sensitive specs only; running the feature
      // specs here as well duplicated `phone-iphone` at nearly the same
      // width for nearly the same result.
      testMatch: [SPECS.coreFlows, SPECS.touchAffordances, SPECS.touchSmoke],
    },
  ],
});
