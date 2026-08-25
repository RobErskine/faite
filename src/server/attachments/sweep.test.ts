import { describe, expect, it } from "vitest";
import {
  isCollectable,
  shouldRescheduleImmediately,
  shouldScheduleSweep,
  SWEEP_AFTER_MS,
  SWEEP_BATCH,
  sweepCutoff,
} from "./sweep";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe("the undo window", () => {
  /**
   * The assertion this file exists for. Sweeping inside the undo window
   * deletes objects that ⌘Z is about to re-reference, leaving live rows
   * pointing at nothing — the mirror image of the failure EI-242's
   * bytes-first ordering prevents.
   */
  it("REFUSES to collect a tombstone made moments ago", () => {
    expect(isCollectable(iso(0), NOW)).toBe(false);
    expect(isCollectable(iso(-1000), NOW)).toBe(false);
    expect(isCollectable(iso(-60_000), NOW)).toBe(false);
  });

  it("refuses right up to the boundary, and collects past it", () => {
    expect(isCollectable(iso(-SWEEP_AFTER_MS + 1000), NOW)).toBe(false);
    expect(isCollectable(iso(-SWEEP_AFTER_MS - 1000), NOW)).toBe(true);
  });

  it("keeps a window far longer than undo can survive", () => {
    // Undo history is in-memory and dies on reload, so the real exposure is
    // one session. A window that ever drops near it should fail here first.
    expect(SWEEP_AFTER_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });

  it("never collects a row that is not tombstoned at all", () => {
    expect(isCollectable(null, NOW)).toBe(false);
  });

  it("compares ISO strings in true timestamp order", () => {
    // The SQL filter is a string comparison (`deleted_at < ?`), which is only
    // correct because these are zero-padded UTC. A local-time or unpadded
    // stamp would sort wrong and collect live files.
    expect(sweepCutoff(NOW) < iso(0)).toBe(true);
    expect(sweepCutoff(NOW).endsWith("Z")).toBe(true);
    expect(sweepCutoff(NOW)).toBe("2026-08-24T12:00:00.000Z");
  });
});

describe("batching", () => {
  it("chains another alarm on a full batch, so a bulk delete drains", () => {
    // Otherwise 500 deleted files would collect 100 per day.
    expect(shouldRescheduleImmediately(SWEEP_BATCH)).toBe(true);
  });

  it("stops when the batch comes back short", () => {
    expect(shouldRescheduleImmediately(SWEEP_BATCH - 1)).toBe(false);
    expect(shouldRescheduleImmediately(0)).toBe(false);
  });
});

describe("scheduling", () => {
  it("schedules only into empty space", () => {
    expect(shouldScheduleSweep(null)).toBe(true);
  });

  it("REFUSES to overwrite a pending alarm", () => {
    // `setAlarm` overwrites. Scheduling unconditionally on every push would
    // shove the sweep permanently into the future on an active account —
    // exactly the account whose deleted files most need collecting.
    expect(shouldScheduleSweep(NOW + 1000)).toBe(false);
    expect(shouldScheduleSweep(0)).toBe(false);
  });
});
