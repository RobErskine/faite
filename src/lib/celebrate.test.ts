// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confettiPalette, originOf } from "./celebrate";
import { isTintableColor } from "./colors";

/**
 * happy-dom has no layout: `getBoundingClientRect()` returns all zeros for
 * every element, which `originOf` correctly reads as "not on screen". So every
 * test that wants a real position has to say what it is. Without this helper it
 * is very easy to write a test that passes vacuously because the degenerate-rect
 * guard fired before the assertion ever mattered.
 */
function elementAt(rect: Partial<DOMRect>): Element {
  const el = document.createElement("div");
  const box = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, ...rect };
  el.getBoundingClientRect = () => ({ ...box, toJSON: () => box }) as DOMRect;
  return el;
}

describe("originOf", () => {
  beforeEach(() => {
    window.innerWidth = 1000;
    window.innerHeight = 500;
  });

  it("normalises the centre of the rect against the viewport", () => {
    const el = elementAt({ left: 200, top: 100, width: 100, height: 50, right: 300, bottom: 150 });
    // centre is (250, 125) of a 1000x500 viewport
    expect(originOf(el)).toEqual({ x: 0.25, y: 0.25 });
  });

  it("is null without an element — a sub-task row that never rendered", () => {
    expect(originOf(null)).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });

  it("is null for a zero-area rect — a display:none ancestor", () => {
    expect(originOf(elementAt({}))).toBeNull();
  });

  it("is null when the element is entirely off-viewport", () => {
    // Scrolled up out of its column.
    expect(
      originOf(elementAt({ left: 10, top: -80, width: 60, height: 20, right: 70, bottom: -60 })),
    ).toBeNull();
    // Past the right edge.
    expect(
      originOf(elementAt({ left: 1200, top: 10, width: 60, height: 20, right: 1260, bottom: 30 })),
    ).toBeNull();
  });

  it("still fires for a rect straddling an edge — off-screen is honest", () => {
    const el = elementAt({ left: -20, top: 100, width: 60, height: 20, right: 40, bottom: 120 });
    expect(originOf(el)).not.toBeNull();
  });
});

describe("confettiPalette", () => {
  /**
   * The regression test for this whole module. `canvas-confetti` parses colors
   * with /^#?([a-f\d]{2}){3}$/ and THROWS on anything else — so the eight-digit
   * output of `tint()`/`edge()`/`wash()` in `colors.ts` is unusable here. If
   * someone reaches for those helpers, this fails.
   */
  it("returns only six-digit hex, for every input", () => {
    for (const input of ["#46a758", "#000000", "#ffffff", null, undefined, "#abc", "oklch(0.5 0 0)"]) {
      for (const color of confettiPalette(input)) {
        expect(isTintableColor(color)).toBe(true);
      }
    }
  });

  it("leads with the to-do's own colour, then a lighter and a darker shade", () => {
    const [base, lighter, darker] = confettiPalette("#46a758");
    expect(base).toBe("#46a758");
    expect(lighter).not.toBe(base);
    expect(darker).not.toBe(base);
    // Lighter is nearer white, darker nearer black, on the red channel.
    expect(Number.parseInt(lighter.slice(1, 3), 16)).toBeGreaterThan(0x46);
    expect(Number.parseInt(darker.slice(1, 3), 16)).toBeLessThan(0x46);
  });

  it("falls back to neutral for a to-do with no colour, rather than inventing one", () => {
    // Backlog and unfiled to-dos have no colour — that is a real answer from
    // `effectiveListColor`, not missing data.
    const neutral = confettiPalette(null);
    expect(neutral).toHaveLength(3);
    expect(neutral).toEqual(confettiPalette(undefined));
    expect(neutral).not.toContain("#46a758");
  });

  it("rejects values it cannot parse, rather than concatenating them", () => {
    // A synced row from a client that stored oklch, or `#rgb` shorthand.
    expect(confettiPalette("oklch(0.7 0.15 145)")).toEqual(confettiPalette(null));
    expect(confettiPalette("#abc")).toEqual(confettiPalette(null));
  });
});

describe("celebrate", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("canvas-confetti");
  });

  it("fires two shots, angled apart, at the given origin and in the given colours", async () => {
    const confetti = vi.fn();
    vi.doMock("canvas-confetti", () => ({ default: confetti }));
    const { celebrate } = await import("./celebrate");

    await celebrate({ x: 0.25, y: 0.5 }, "#46a758");

    expect(confetti).toHaveBeenCalledTimes(2);
    const [first, second] = confetti.mock.calls.map((c) => c[0]);
    // 60 and 120, not a single 90: one angle is a fountain, two are a burst
    // going up AND out — which is the whole point of the effect.
    expect(first.angle).toBe(60);
    expect(second.angle).toBe(120);
    for (const shot of [first, second]) {
      expect(shot.origin).toEqual({ x: 0.25, y: 0.5 });
      expect(shot.colors[0]).toBe("#46a758");
      // Three local `prefersReducedMotion` helpers already exist; this uses
      // the library's own check instead of adding a fourth.
      expect(shot.disableForReducedMotion).toBe(true);
    }
  });

  it("does nothing without an origin — and never loads the library", async () => {
    const confetti = vi.fn();
    vi.doMock("canvas-confetti", () => ({ default: confetti }));
    const { celebrate } = await import("./celebrate");

    await celebrate(null, "#46a758");
    await celebrate(undefined, null);

    expect(confetti).not.toHaveBeenCalled();
  });

  it("swallows a failed chunk load — a decoration never breaks a completion", async () => {
    vi.doMock("canvas-confetti", () => {
      throw new Error("chunk load failed");
    });
    const { celebrate } = await import("./celebrate");

    await expect(celebrate({ x: 0.5, y: 0.5 }, "#46a758")).resolves.toBeUndefined();
  });
});
