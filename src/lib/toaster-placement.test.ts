import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const OPEN_SHEET = `body:has([data-slot="sheet-content"]:not([data-closed])) [data-sonner-toaster]`;

describe("toaster placement while a sheet is open", () => {
  it("moves the toaster off the right edge, where the drawer footer sits", () => {
    const rule = css.indexOf(`${OPEN_SHEET} {`);
    expect(rule).toBeGreaterThan(-1);
    const body = css.slice(rule, css.indexOf("}", rule));
    expect(body).toContain("right: auto");
    expect(body).toContain("left:");
  });

  it("moves it to the top below 640px", () => {
    const media = css.indexOf("@media (max-width: 639.98px)");
    expect(media).toBeGreaterThan(-1);
    const rule = css.indexOf(OPEN_SHEET, media);
    expect(rule).toBeGreaterThan(media);
    const body = css.slice(rule, css.indexOf("}", rule));
    expect(body).toContain("top:");
    expect(body).toContain("bottom: auto");
  });
});
