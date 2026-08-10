// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canJumpBack,
  canJumpForward,
  clampJumpTarget,
  computeAnchorIndex,
  computeVisibleCount,
  useDayTrack,
} from "./use-day-track";

describe("computeAnchorIndex", () => {
  it("divides scroll position by column pitch", () => {
    expect(computeAnchorIndex(0, 169)).toBe(0);
    expect(computeAnchorIndex(169 * 3, 169)).toBe(3);
  });

  it("rounds to the nearest column mid-scroll", () => {
    expect(computeAnchorIndex(169 * 3 + 80, 169)).toBe(3);
    expect(computeAnchorIndex(169 * 3 + 90, 169)).toBe(4);
  });

  it("is 0 when the pitch has not been measured yet", () => {
    expect(computeAnchorIndex(500, 0)).toBe(0);
  });
});

describe("computeVisibleCount", () => {
  it("divides track width by column pitch", () => {
    expect(computeVisibleCount(169 * 7, 169)).toBe(7);
  });

  it("is never less than 1, even on a sliver of width", () => {
    expect(computeVisibleCount(10, 169)).toBe(1);
  });

  it("is 1 when the pitch has not been measured yet", () => {
    expect(computeVisibleCount(1000, 0)).toBe(1);
  });
});

describe("clampJumpTarget", () => {
  it("adds the delta to the anchor", () => {
    expect(clampJumpTarget(0, 7, 180)).toBe(7);
    expect(clampJumpTarget(10, -7, 180)).toBe(3);
  });

  it("clamps at 0, never going negative", () => {
    expect(clampJumpTarget(3, -7, 180)).toBe(0);
  });

  it("clamps at cap - 1", () => {
    expect(clampJumpTarget(175, 90, 180)).toBe(179);
  });
});

describe("canJumpBack", () => {
  it("is true when the full delta fits before the anchor", () => {
    expect(canJumpBack(7, 7)).toBe(true);
    expect(canJumpBack(10, 7)).toBe(true);
  });

  it("is false once the jump would go negative", () => {
    expect(canJumpBack(6, 7)).toBe(false);
    expect(canJumpBack(0, 7)).toBe(false);
  });
});

describe("canJumpForward", () => {
  it("is true when the full delta fits inside the cap", () => {
    expect(canJumpForward(0, 7, 180)).toBe(true);
    expect(canJumpForward(172, 7, 180)).toBe(true);
  });

  it("is false once the jump would reach or pass the cap", () => {
    expect(canJumpForward(173, 7, 180)).toBe(false);
    expect(canJumpForward(179, 1, 180)).toBe(false);
  });
});

/**
 * The hook's own wiring, which the pure functions above cannot reach.
 *
 * happy-dom has no layout, so the track and its first column are stubbed to the
 * one measurement `measurePitch` actually takes. That is enough for what matters
 * here: whether a queued jump reaches `scrollTo` exactly once per request.
 */
/** The real board's numbers: `--column-min` is 10.5rem and the track is `gap-px`. */
const COLUMN_WIDTH = 168;
const GAP = 1;
const PITCH = COLUMN_WIDTH + GAP;

/** The 40px collapsed weekend strip, which must never be what pitch is read from. */
const STRIP_WIDTH = 40;

/**
 * @param leadingStrip prepends a collapsed weekend strip, as the track has when
 * the board is opened on a Saturday with weekends hidden.
 */
function stubTrack({ leadingStrip = false } = {}) {
  const track = document.createElement("div");
  document.body.appendChild(track);

  if (leadingStrip) {
    const strip = document.createElement("div");
    strip.getBoundingClientRect = () =>
      ({ width: STRIP_WIDTH }) as unknown as DOMRect;
    track.appendChild(strip);
  }

  const column = document.createElement("div");
  // `measurePitch` looks for a real day column by this attribute rather than
  // taking the first child, which may be the 40px strip above.
  column.setAttribute("data-day-column", "");
  column.getBoundingClientRect = () =>
    ({ width: COLUMN_WIDTH }) as unknown as DOMRect;
  track.appendChild(column);

  // The gap is set explicitly rather than left to default, so `getComputedStyle`
  // cannot hand back the `normal` keyword that `measurePitch` guards against.
  track.style.columnGap = `${GAP}px`;
  const scrollTo = vi.fn();
  track.scrollTo = scrollTo as unknown as typeof track.scrollTo;

  return { ref: { current: track }, scrollTo };
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("useDayTrack", () => {
  const setup = (trackOpts?: { leadingStrip?: boolean }) => {
    const { ref, scrollTo } = stubTrack(trackOpts);
    const onExtend = vi.fn();
    const view = renderHook(() => useDayTrack({ trackRef: ref, cap: 365, onExtend }));
    return { ...view, scrollTo, onExtend };
  };

  /**
   * `measurePitch` used to take `track.firstElementChild`, which was exact
   * while every child was a day column. A collapsed weekend strip broke that
   * assumption silently: 40px instead of 168 deflates the pitch by 4x, so
   * "jump forward a week" scrolls less than two days and the board looks
   * stuck rather than wrong.
   */
  it("measures pitch from a day column, not a leading weekend strip", () => {
    const { result, scrollTo } = setup({ leadingStrip: true });
    act(() => result.current.jumpToIndex(5));
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ left: 5 * PITCH }),
    );
  });

  it("extends the horizon before scrolling, so the target exists", () => {
    const { result, onExtend, scrollTo } = setup();
    act(() => result.current.jumpToIndex(5));
    // `clamped + 1` days, because an index of 5 needs 6 rendered.
    expect(onExtend).toHaveBeenCalledWith(6);
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ left: 5 * PITCH }),
    );
  });

  /*
    THE REGRESSION THIS FILE EXISTS FOR.

    The queued jump used to be a bare `number | null` that the layout effect
    cleared on its way out, purely so that a second jump to the same index still
    registered as a state change. Replacing that clear with a monotonic `seq`
    removed a setState-from-an-effect — but if the seq is ever dropped, or the
    request is memoised on `target`, this is what silently breaks: pressing
    Week-forward twice from the same anchor scrolls once.
  */
  it("serves a repeat jump to the same index", () => {
    const { result, scrollTo } = setup();
    act(() => result.current.jumpToIndex(5));
    act(() => result.current.jumpToIndex(5));
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("floors a negative target at today", () => {
    const { result, scrollTo } = setup();
    act(() => result.current.jumpToIndex(-3));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 0 }));
  });

  it("scrolls once per request, not once per render", () => {
    // The effect records the seq it served, so a re-render for any other reason
    // must not re-scroll to a stale target.
    const { result, rerender, scrollTo } = setup();
    act(() => result.current.jumpToIndex(5));
    rerender();
    rerender();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("does nothing until a jump is requested", () => {
    const { scrollTo } = setup();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
