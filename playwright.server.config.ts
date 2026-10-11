import { defineConfig, devices } from "@playwright/test";

/**
 * The server-backed E2E suite (EI-354): specs that need `/api/auth/*`,
 * `/api/sync/*`, `/api/v1/*` or `/mcp` — none of which exist on the :3000
 * server `playwright.config.ts` drives. Run with `npm run e2e:server`.
 *
 * A separate config, not a project in the main one, because a config has ONE
 * `webServer`. A `server` project there would be scheduled by every plain
 * `playwright test` — the full local matrix and CI's `e2e: full` dispatch —
 * against `next start`, where there is no worker, and fail. Kept apart, the
 * main suite cannot pick these specs up (its `testIgnore` excludes
 * `e2e/server/`) and this one cannot pick up the local-first specs.
 * `e2e/config-coverage.test.ts` holds both halves of that.
 *
 * The full rationale — server choice, D1 lifecycle, what runs where — is
 * docs/E2E.md §10.
 */
// 8787 is wrangler's default and what `opennextjs-cloudflare preview` binds.
// "localhost", matching the main config and TRUSTED_ORIGINS in
// src/server/auth.ts — Better Auth and the sync routes check `Origin`.
const BASE_URL = "http://localhost:8787";

export default defineConfig({
  testDir: "./e2e/server",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One wrangler process (one workerd, one local D1, the Durable Objects)
  // serves every worker, and the sync specs open two browser contexts per
  // test. At Playwright's local default (5 workers on a 10-core laptop) the
  // suite flaked — boards slow to boot, a sync push missing its 20s window.
  // Not a clean measurement: some of those runs overlapped a preview rebuild
  // (docs/E2E.md §10). 2 is the conservative value until EI-360 measures it
  // on a quiet machine. Each test signs up its own account, so this is about
  // CPU, not shared data.
  workers: 2,
  // Its own report folder: in CI this suite runs in the same job as the
  // :3000 gate, after it, and would otherwise overwrite that run's report.
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report-server" }]]
    : "list",
  // Higher than the main suite's 30s: a write has to leave one client, pass
  // the 2s outbox debounce (src/lib/sync/engine.ts), land in the Durable
  // Object, and reach a second client.
  timeout: 60_000,

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: {
    // Build + preview without the `preview` npm script's agentation companion
    // — the same reason the main config bypasses `npm run dev`. The build is
    // most of the startup: preview serves a fixed bundle and never hot-reloads
    // (README), so a stale bundle would test old code. Locally, an already
    // running `npm run preview` is reused instead — restart it after editing
    // `src/` or this suite tests what you had before.
    command:
      process.env.E2E_SERVER ??
      "NEXT_PUBLIC_APP_ENV=development npx opennextjs-cloudflare build && npx opennextjs-cloudflare preview",
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    // Cold `npm run e2e:server` measured 49s end to end on an M-series laptop
    // with `.next/cache` warm; a first-ever build is several times that.
    timeout: 600_000,
    // "ignore", unlike the main config: this server logs every request and the
    // build logs every chunk, which buries the test output. A failed build
    // still surfaces — Playwright reports the exit code and stderr.
    stdout: "ignore",
    stderr: "pipe",
  },

  projects: [
    {
      name: "server",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
