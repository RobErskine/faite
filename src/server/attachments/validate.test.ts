import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES, MAX_OWNER_ATTACHMENT_BYTES } from "@/lib/attachment-limits";
import { AttachmentRejected, sanitizeFilename, validateUpload } from "./validate";

/**
 * The upload gate. Most of these are security tests rather than correctness
 * ones — the governing rule is that a client's `Content-Type` is a claim, so
 * every case below is some version of "can a lie get through".
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const GIF89 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const GIF87 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
/** "RIFF" but not WEBP — a .wav, which must not pass as an image. */
const WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);
const CSV = new TextEncoder().encode("name,qty\nbolts,4\n");

function reject(fn: () => unknown): AttachmentRejected {
  try {
    fn();
  } catch (error) {
    if (error instanceof AttachmentRejected) return error;
    throw error;
  }
  throw new Error("expected a rejection, got none");
}

describe("validateUpload", () => {
  it("accepts each allow-listed binary format on its real magic number", () => {
    const cases: Array<[Uint8Array, string]> = [
      [PNG, "image/png"],
      [JPEG, "image/jpeg"],
      [GIF89, "image/gif"],
      [GIF87, "image/gif"],
      [WEBP, "image/webp"],
      [PDF, "application/pdf"],
    ];
    for (const [bytes, type] of cases) {
      expect(validateUpload(bytes, type, "f", false).mimeType).toBe(type);
    }
  });

  it("accepts text formats, which have no magic number, by decoding them", () => {
    expect(validateUpload(CSV, "text/csv", "rows.csv", false).byteSize).toBe(CSV.byteLength);
  });

  it("ignores charset parameters and casing on the declared type", () => {
    expect(validateUpload(CSV, "TEXT/CSV; charset=utf-8", "rows.csv", false).mimeType).toBe(
      "text/csv",
    );
  });

  // ---- the ones that matter -------------------------------------------

  it("REJECTS an SVG outright — it is a script host, not an image", () => {
    const svg = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    expect(reject(() => validateUpload(svg, "image/svg+xml", "x.svg", false)).code).toBe(
      "unsupported-type",
    );
  });

  it("REJECTS an SVG relabelled as PNG — the bytes are checked, not the label", () => {
    const svg = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    expect(reject(() => validateUpload(svg, "image/png", "x.png", false)).code).toBe(
      "content-mismatch",
    );
  });

  it("REJECTS HTML relabelled as text/csv — arbitrary text is still only text", () => {
    // Decodes as UTF-8, so it passes the text check and is stored as csv.
    // That is intended: `Content-Disposition: attachment` + `nosniff` on the
    // download is what makes text safe to serve, not the upload gate. This
    // test pins the reasoning so nobody "fixes" it into a content filter.
    const html = new TextEncoder().encode("<script>alert(1)</script>");
    expect(validateUpload(html, "text/csv", "x.csv", false).mimeType).toBe("text/csv");
  });

  it("REJECTS binary junk claiming to be text", () => {
    // 0xC3 starts a 2-byte sequence; 0x28 cannot continue it.
    const invalidUtf8 = new Uint8Array([0xc3, 0x28, 0xa0, 0xa1]);
    expect(reject(() => validateUpload(invalidUtf8, "text/plain", "x.txt", false)).code).toBe(
      "content-mismatch",
    );
  });

  it("REJECTS a WAV claiming to be a WEBP — both halves of RIFF are checked", () => {
    expect(reject(() => validateUpload(WAV, "image/webp", "x.webp", false)).code).toBe(
      "content-mismatch",
    );
  });

  it("REJECTS a type that is not allow-listed at all", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    expect(reject(() => validateUpload(zip, "application/zip", "x.zip", false)).code).toBe(
      "unsupported-type",
    );
  });

  it("REJECTS a file with no declared type", () => {
    expect(reject(() => validateUpload(PNG, "", "x", false)).code).toBe("unsupported-type");
  });

  it("REJECTS an empty file before anything else", () => {
    expect(reject(() => validateUpload(new Uint8Array(0), "image/png", "x.png", false)).code).toBe(
      "empty",
    );
  });

  it("REJECTS a nameless file", () => {
    expect(reject(() => validateUpload(PNG, "image/png", null, false)).code).toBe(
      "missing-filename",
    );
  });

  it("REJECTS a truncated file too short to hold its own signature", () => {
    expect(reject(() => validateUpload(new Uint8Array([0x89, 0x50]), "image/png", "x", false)).code)
      .toBe("content-mismatch");
  });

  // ---- caps ------------------------------------------------------------

  it("enforces the standard cap, and reports size before content", () => {
    const oversized = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    // Deliberately NOT a valid PNG: size must win, or an oversized upload
    // reports the wrong reason.
    expect(reject(() => validateUpload(oversized, "image/png", "x.png", false)).code).toBe(
      "too-large",
    );
  });

  it("gives the owner the raised cap for the same file", () => {
    const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    big.set(PDF, 0);
    expect(reject(() => validateUpload(big, "application/pdf", "x.pdf", false)).code).toBe(
      "too-large",
    );
    expect(validateUpload(big, "application/pdf", "x.pdf", true).byteSize).toBe(big.byteLength);
  });

  it("still caps the owner — the raised limit is not an absent one", () => {
    const huge = new Uint8Array(MAX_OWNER_ATTACHMENT_BYTES + 1);
    expect(reject(() => validateUpload(huge, "application/pdf", "x.pdf", true)).code).toBe(
      "too-large",
    );
  });
});

describe("sanitizeFilename", () => {
  it("strips the characters that could inject into Content-Disposition", () => {
    expect(sanitizeFilename('re"port\\name.pdf')).toBe("reportname.pdf");
  });

  it("strips control characters, including a CRLF header break", () => {
    expect(sanitizeFilename("a\r\nX-Evil: 1.pdf")).toBe("aX-Evil: 1.pdf");
  });

  it("collapses path separators rather than dropping them silently", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe(".._.._etc_passwd");
  });

  it("truncates a very long name instead of rejecting it", () => {
    expect(sanitizeFilename("a".repeat(500))).toHaveLength(200);
  });

  it("leaves an ordinary unicode name alone", () => {
    expect(sanitizeFilename("Rechnung – März.pdf")).toBe("Rechnung – März.pdf");
  });
});
