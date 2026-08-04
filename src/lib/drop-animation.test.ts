import { describe, expect, it } from "vitest";
import { landingTransform } from "./drop-animation";

/**
 * Only the rect math is tested. The animation itself needs layout and WAAPI,
 * neither of which exists in the node test environment — per the drag-and-drop
 * doc, prefer extracting a pure function over trying to test dnd-kit.
 */
describe("landingTransform", () => {
  const transform = { x: 120, y: 240 };

  it("leaves the transform alone when the overlay is already on the target", () => {
    expect(
      landingTransform({
        overlayRect: { left: 400, top: 300, width: 200 },
        landingRect: { left: 400, top: 300, width: 200 },
        transform,
      }),
    ).toEqual({ x: 120, y: 240 });
  });

  it("moves down and right when the target is below and right of the overlay", () => {
    expect(
      landingTransform({
        overlayRect: { left: 400, top: 300, width: 200 },
        landingRect: { left: 460, top: 380, width: 200 },
        transform,
      }),
    ).toEqual({ x: 180, y: 320 });
  });

  it("moves up and left when the target is above and left of the overlay", () => {
    expect(
      landingTransform({
        overlayRect: { left: 400, top: 300, width: 200 },
        landingRect: { left: 340, top: 220, width: 200 },
        transform,
      }),
    ).toEqual({ x: 60, y: 160 });
  });

  it("is unaffected by a width difference between overlay and target", () => {
    const wide = landingTransform({
      overlayRect: { left: 400, top: 300, width: 200 },
      landingRect: { left: 460, top: 380, width: 320 },
      transform,
    });
    const narrow = landingTransform({
      overlayRect: { left: 400, top: 300, width: 200 },
      landingRect: { left: 460, top: 380, width: 120 },
      transform,
    });
    expect(wide).toEqual(narrow);
  });

  it("handles a zero starting transform", () => {
    expect(
      landingTransform({
        overlayRect: { left: 100, top: 100, width: 200 },
        landingRect: { left: 250, top: 40, width: 200 },
        transform: { x: 0, y: 0 },
      }),
    ).toEqual({ x: 150, y: -60 });
  });
});
