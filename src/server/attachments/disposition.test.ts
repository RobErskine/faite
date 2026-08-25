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

  it("keeps everything else as attachment by default", () => {
    for (const type of ["application/pdf", "text/csv", "text/plain", "application/json"]) {
      expect(contentDisposition("a.pdf", type)).toMatch(/^attachment;/);
    }
  });

  it("opens a PDF inline ONLY when preview is explicitly asked for (EI-243)", () => {
    // Default: a link to this URL downloads. `?preview=1`: the dialog's
    // iframe can render it, and the route adds `CSP: sandbox` alongside.
    expect(contentDisposition("a.pdf", "application/pdf")).toMatch(/^attachment;/);
    expect(contentDisposition("a.pdf", "application/pdf", true)).toMatch(/^inline;/);
  });

  it("does NOT let preview widen anything beyond PDF", () => {
    // The flag is a rendering hint for one format, not a general "serve it
    // inline" switch. A text/* file rendered inline on our origin would be a
    // real hole — `text/plain` is sniffable in some contexts, and the whole
    // point of the text preview is that WE fetch and escape it.
    for (const type of ["text/csv", "text/plain", "text/markdown", "application/json"]) {
      expect(contentDisposition("a.txt", type, true)).toMatch(/^attachment;/);
    }
    expect(contentDisposition("x.svg", "image/svg+xml", true)).toMatch(/^attachment;/);
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
