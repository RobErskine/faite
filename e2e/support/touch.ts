import type { Page, CDPSession } from "@playwright/test";

/**
 * Real touch input, via the Chrome DevTools Protocol.
 *
 * `locator.dispatchEvent()` does NOT work for this: Playwright's own docs
 * note it does not set `Event.isTrusted`, and an untrusted `touchmove` does
 * not drive native scrolling or dnd-kit's `TouchSensor` — the event fires,
 * the browser does nothing with it. `Input.dispatchTouchEvent` is a real,
 * OS-level input event as far as the renderer is concerned, so it is the only
 * way to prove a scroll-snap pager or a long-press drag actually works,
 * rather than merely that a handler was called. Chromium-only, hence these
 * tests are restricted to the `phone-*` projects (see playwright.config.ts).
 *
 * See docs/E2E.md "Tier B: gestures" for the full rationale.
 */

interface Point {
  x: number;
  y: number;
}

async function session(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

async function dispatch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  points: Point[],
): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: 1 })),
  });
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * A single-finger swipe: down, a series of moves toward `to`, up. No pause
 * between down and the first move, so this reads as a flick rather than a
 * long-press — the gesture dnd-kit's `TouchSensor` `activationConstraint`
 * (delay: 250, tolerance: 8, board.tsx sensors) is specifically tuned to
 * cancel on, in favor of native scroll.
 */
export async function swipe(
  page: Page,
  from: Point,
  to: Point,
  opts: { steps?: number; stepDelayMs?: number } = {},
): Promise<void> {
  const { steps = 10, stepDelayMs = 16 } = opts;
  const cdp = await session(page);
  try {
    await dispatch(cdp, "touchStart", [from]);
    for (let i = 1; i <= steps; i++) {
      await dispatch(cdp, "touchMove", [lerp(from, to, i / steps)]);
      await page.waitForTimeout(stepDelayMs);
    }
    await dispatch(cdp, "touchEnd", []);
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/**
 * Touch-and-hold past dnd-kit's `TouchSensor` activation delay, then drag to
 * `to` and release — the touch equivalent of a mouse-based drag-and-drop.
 *
 * `holdMs` must clear `activationConstraint.delay` (board.tsx sensors)
 * before the first move, or the gesture reads as a flick/scroll instead of a
 * drag. That delay is itself coarse-aware as of P1 — 400ms on a coarse
 * pointer, which every project this helper runs under is (see
 * playwright.config.ts's `defaultBrowserType: "chromium"` override) — so
 * 550ms leaves real margin rather than sitting right on the boundary a
 * `waitForTimeout` can occasionally undershoot under CI scheduling jitter.
 */
export async function longPressDrag(
  page: Page,
  from: Point,
  to: Point,
  opts: { holdMs?: number; steps?: number; stepDelayMs?: number } = {},
): Promise<void> {
  const { holdMs = 550, steps = 8, stepDelayMs = 16 } = opts;
  const cdp = await session(page);
  try {
    await dispatch(cdp, "touchStart", [from]);
    await page.waitForTimeout(holdMs);
    for (let i = 1; i <= steps; i++) {
      await dispatch(cdp, "touchMove", [lerp(from, to, i / steps)]);
      await page.waitForTimeout(stepDelayMs);
    }
    // A drop needs the overlay to register the final position before release.
    await page.waitForTimeout(stepDelayMs);
    await dispatch(cdp, "touchEnd", []);
  } finally {
    await cdp.detach().catch(() => {});
  }
}
