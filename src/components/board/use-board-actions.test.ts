import { describe, expect, it } from "vitest";
import { computeAutoScroll } from "./use-board-actions";

describe("computeAutoScroll", () => {
  it("is off on phone — dnd-kit's incremental scroll fights the pager's scroll-snap", () => {
    expect(computeAutoScroll("phone")).toBe(false);
  });

  it("is on for tablet and desktop", () => {
    expect(computeAutoScroll("tablet")).toBe(true);
    expect(computeAutoScroll("desktop")).toBe(true);
  });
});
