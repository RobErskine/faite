/**
 * Reconnect pacing for `ws-transport.ts`, as a pure function of the attempt
 * count so it can be unit-tested without a socket, a timer, or a network.
 *
 * DOM-free (see `ws-protocol.ts`'s header for why that matters), though
 * nothing under `src/server` imports this today.
 *
 * ## Why "give up" is not permanent
 *
 * `docs/SYNC.md`'s P4 sketch said to stop retrying after N failures and stay
 * on HTTP polling "for this session". That is too brittle in exactly the
 * cases that produce the failures: a closed laptop lid, a subway ride, a
 * `wrangler deploy` (which disconnects every WebSocket on every Durable
 * Object). Any of those burns the whole retry budget in a few seconds
 * against a network that simply isn't there, and the user then polls at 30s
 * for the rest of the day with a perfectly good connection available.
 *
 * So `MAX_ATTEMPTS` pauses the timer loop rather than disabling the
 * transport. `online` and `visibilitychange -> visible` reset the counter and
 * re-arm — they are real evidence that conditions changed, which a timer
 * never is.
 */

/** Attempts before the timer loop pauses to wait for a real signal. */
export const MAX_ATTEMPTS = 6;

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;
const JITTER_RATIO = 0.25;

/**
 * How long a connection must stay open before its predecessors are forgiven.
 * Without this, a socket that flaps every 20s accumulates `attempt` forever
 * and ends up pinned at `MAX_DELAY_MS`; with it, a genuinely stable session
 * always starts its next reconnect fast.
 */
export const STABLE_CONNECTION_MS = 30_000;

/**
 * Exponential with full jitter, capped. `attempt` is 0-based: the first
 * retry after the first failure is `nextDelay(0)`.
 *
 * Jitter matters even for one user: every tab reconnects on the same trigger
 * (a deploy, a wake from sleep), and without it they retry in lockstep and
 * hammer the same Durable Object simultaneously.
 *
 * `random` is injectable purely so the tests can pin the bounds; production
 * callers omit it.
 */
export function nextDelay(attempt: number, random: () => number = Math.random): number {
  const clamped = Math.max(0, Math.floor(attempt));
  const exponential = Math.min(BASE_DELAY_MS * 2 ** clamped, MAX_DELAY_MS);
  const jitter = exponential * JITTER_RATIO;
  return Math.round(exponential - jitter + random() * (2 * jitter));
}

/** True once the timer loop should stop and wait for `online`/`visible`. */
export function shouldPause(attempt: number): boolean {
  return attempt >= MAX_ATTEMPTS;
}

/**
 * The attempt counter to carry into the next reconnect. A connection that
 * survived `STABLE_CONNECTION_MS` resets the ladder; a short-lived one
 * advances it.
 */
export function nextAttempt(attempt: number, openDurationMs: number): number {
  return openDurationMs >= STABLE_CONNECTION_MS ? 0 : attempt + 1;
}
