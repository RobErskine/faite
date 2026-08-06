import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, nextAttempt, nextDelay, shouldPause, STABLE_CONNECTION_MS } from "./backoff";

const MID = () => 0.5;
const LOW = () => 0;
const HIGH = () => 1 - Number.EPSILON;

describe("nextDelay", () => {
  it("starts small — a first reconnect should feel instant", () => {
    expect(nextDelay(0, MID)).toBeLessThan(1000);
  });

  it("grows monotonically until it saturates", () => {
    const delays = Array.from({ length: 8 }, (_, i) => nextDelay(i, MID));
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  });

  it("caps, so a long outage never schedules a retry minutes away", () => {
    expect(nextDelay(50, HIGH)).toBeLessThanOrEqual(40_000);
  });

  it("never returns a negative or zero-forever delay", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(nextDelay(attempt, LOW)).toBeGreaterThan(0);
      expect(nextDelay(attempt, HIGH)).toBeGreaterThan(0);
    }
  });

  it("jitters — two tabs reconnecting on the same trigger must not march in lockstep", () => {
    // Every tab reconnects on the same signal (a deploy, a wake from sleep),
    // and they all share one Durable Object.
    expect(nextDelay(4, LOW)).not.toBe(nextDelay(4, HIGH));
  });

  it("keeps jitter proportionate rather than unbounded", () => {
    const low = nextDelay(4, LOW);
    const high = nextDelay(4, HIGH);
    expect(high / low).toBeLessThan(2);
  });

  it("treats a negative or fractional attempt as attempt 0 rather than looping", () => {
    expect(nextDelay(-3, MID)).toBe(nextDelay(0, MID));
    expect(nextDelay(0.7, MID)).toBe(nextDelay(0, MID));
  });
});

describe("shouldPause", () => {
  it("does not pause before the budget is spent", () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect(shouldPause(attempt)).toBe(false);
    }
  });

  it("pauses once the budget is spent", () => {
    expect(shouldPause(MAX_ATTEMPTS)).toBe(true);
    expect(shouldPause(MAX_ATTEMPTS + 10)).toBe(true);
  });
});

describe("nextAttempt", () => {
  it("advances the ladder after a short-lived connection", () => {
    expect(nextAttempt(0, 1_000)).toBe(1);
    expect(nextAttempt(3, STABLE_CONNECTION_MS - 1)).toBe(4);
  });

  it("resets the ladder after a connection that proved stable", () => {
    expect(nextAttempt(5, STABLE_CONNECTION_MS)).toBe(0);
    expect(nextAttempt(5, 10 * STABLE_CONNECTION_MS)).toBe(0);
  });

  it("REGRESSION: a flapping socket cannot accumulate to a permanent pause", () => {
    // Without the reset, a connection that survives 45s and dies, over and
    // over, walks `attempt` up forever: the user ends up pinned at the max
    // delay (and then paused) despite having a usable network the whole
    // time. This is the scenario that made "give up permanently" the wrong
    // design -- see backoff.ts's header.
    let attempt = 0;
    for (let cycle = 0; cycle < 20; cycle += 1) {
      attempt = nextAttempt(attempt, STABLE_CONNECTION_MS + 15_000);
    }
    expect(attempt).toBe(0);
    expect(shouldPause(attempt)).toBe(false);
  });

  it("a genuinely dead network does reach the pause, so the timer loop stops", () => {
    let attempt = 0;
    for (let cycle = 0; cycle < MAX_ATTEMPTS; cycle += 1) {
      attempt = nextAttempt(attempt, 0);
    }
    expect(shouldPause(attempt)).toBe(true);
  });
});
