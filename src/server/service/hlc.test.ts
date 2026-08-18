import { describe, expect, it, vi, afterEach } from "vitest";
import { compareHlc, decodeHlc } from "@/lib/sync/hlc-core";
import { serverHlcClock } from "./hlc";

afterEach(() => {
  vi.useRealTimers();
});

describe("serverHlcClock", () => {
  it("stamps the node id it was given", () => {
    expect(decodeHlc(serverHlcClock()()).nodeId).toBe("server");
    expect(decodeHlc(serverHlcClock("do-42")()).nodeId).toBe("do-42");
  });

  it("is strictly monotonic across calls inside a single millisecond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));

    const clock = serverHlcClock();
    const stamps = Array.from({ length: 100 }, clock);

    for (let i = 1; i < stamps.length; i++) {
      expect(compareHlc(stamps[i], stamps[i - 1])).toBeGreaterThan(0);
    }
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it("advances with the wall clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const clock = serverHlcClock();
    const first = clock();

    vi.setSystemTime(new Date("2026-08-17T12:00:01.000Z"));
    const second = clock();

    expect(compareHlc(second, first)).toBeGreaterThan(0);
    expect(decodeHlc(second).phys).toBeGreaterThan(decodeHlc(first).phys);
    // Counter resets once physical time moves on.
    expect(decodeHlc(second).counter).toBe(0);
  });

  it("never goes backwards when the wall clock does", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:01.000Z"));
    const clock = serverHlcClock();
    const first = clock();

    // NTP correction, or two isolates disagreeing.
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const second = clock();

    expect(compareHlc(second, first)).toBeGreaterThan(0);
  });

  it("gives independent clocks independent state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    // Two isolates at the same millisecond DO collide — the documented reason
    // this is safe for creates only. Pinned as a test so the limitation is
    // visible rather than folklore.
    expect(serverHlcClock()()).toBe(serverHlcClock()());
  });
});
