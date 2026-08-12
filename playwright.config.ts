import { defineConfig, devices } from "@playwright/test";

/**
 * The E2E regression gate — desktop, tablet and phone viewports against ONE
 * app tree, ahead of the mobile-responsive work (see docs/E2E.md).
 *
 * `/board` is `ssr:false` (`src/app/board/page.tsx`) and reads only from
 * IndexedDB, so `next dev` renders it identically to a production build —
 * dev is used everywhere for startup speed. Bypasses the `dev` npm script's
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
const PORT = 3000;
// "localhost", not the equivalent "127.0.0.1": Next dev's HMR WebSocket does
// an Origin check the IP literal fails (it isn't "localhost" and isn't in
// next.config.ts's allowedDevOrigins), which silently breaks the handshake —
// and Turbopack's client blocks module loading on that socket, so the whole
// app hangs forever on the `dynamic()` "Loading your board…" fallback with
// no error surfaced anywhere except a WebSocket console warning.
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CDP touch sessions (touch.ts) do not parallelize well against a single
  // worker's browser process on CI runners with few cores; leave Playwright's
  // own default (cpu count) locally, cap it in CI.
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
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
    },
    {
      name: "phone-iphone",
      use: { ...devices["iPhone 15"], defaultBrowserType: "chromium" },
    },
    {
      name: "phone-iphone-landscape",
      use: { ...devices["iPhone 15 landscape"], defaultBrowserType: "chromium" },
    },
    {
      name: "phone-pixel",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
