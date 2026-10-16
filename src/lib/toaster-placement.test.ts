import { describe, expect, it } from "vitest";
import { toasterPosition } from "./toaster-placement";

describe("toasterPosition", () => {
  it("leaves the default alone when no sheet is open", () => {
    expect(toasterPosition(false, 400)).toBeUndefined();
    expect(toasterPosition(false, 1400)).toBeUndefined();
  });

  it("goes top-center while a sheet is open below 1100px", () => {
    expect(toasterPosition(true, 375)).toBe("top-center");
    expect(toasterPosition(true, 800)).toBe("top-center");
    expect(toasterPosition(true, 1099)).toBe("top-center");
  });

  it("goes bottom-left while a sheet is open at 1100px and up", () => {
    expect(toasterPosition(true, 1100)).toBe("bottom-left");
    expect(toasterPosition(true, 1600)).toBe("bottom-left");
  });
});
