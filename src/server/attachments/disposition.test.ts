import { describe, expect, it } from "vitest";
import { contentDisposition } from "./routes";

/**
 * A regression test for a bug that only showed up by opening the sheet and
 * looking: with a blanket `attachment`, Chrome fetches the image, returns
 * 200, and then refuses to paint it — `naturalWidth` stays 0 and every
 * thumbnail is a blank box. Nothing in the request or the response says
 * anything is wrong.
 */
describe("contentDisposition", () => {
  it("serves verified raster images INLINE, or no thumbnail can ever render", () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(contentDisposition("a.png", type)).toMatch(/^inline;/);
    }
  });

  it("keeps everything else as attachment — a PDF must not open on our origin", () => {
    for (const type of ["application/pdf", "text/csv", "text/plain", "application/json"]) {
      expect(contentDisposition("a.pdf", type)).toMatch(/^attachment;/);
    }
  });

  it("never emits inline for SVG, even though it starts with image/", () => {
    // This assertion is why `INLINE_SAFE_TYPES` is an explicit list and not
    // `startsWith("image/")` — the prefix version failed here, which is
    // exactly the silent XSS path it would have opened had SVG ever been
    // allow-listed. Unreachable today (SVG is not in `ALLOWED_MIME_TYPES`),
    // pinned so it stays unreachable.
    expect(contentDisposition("x.svg", "image/svg+xml")).toMatch(/^attachment;/);
  });

  it("emits both the plain and the UTF-8 filename forms", () => {
    const header = contentDisposition("Rechnung März.pdf", "application/pdf");
    expect(header).toContain('filename="Rechnung März.pdf"');
    expect(header).toContain("filename*=UTF-8''Rechnung%20M%C3%A4rz.pdf");
  });
});
