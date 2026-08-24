import {
  ALLOWED_MIME_TYPES,
  type AllowedMimeType,
  isAllowedMimeType,
  MAX_ATTACHMENT_BYTES,
  MAX_FILENAME_LENGTH,
  MAX_OWNER_ATTACHMENT_BYTES,
} from "@/lib/attachment-limits";

/**
 * Everything the upload route refuses, and why.
 *
 * The governing rule: **the client's `Content-Type` is a claim, not a fact.**
 * A browser sets it from the file extension, and a script sets it to
 * whatever it likes. So the declared type is checked against the allow-list
 * AND against the bytes, and a mismatch is a rejection rather than a
 * correction — silently storing `x.pdf` as whatever it turned out to be is
 * how an allow-list gets walked around.
 */

/** First bytes that identify a format. Compared at offset 0 unless noted. */
const MAGIC_NUMBERS: Partial<Record<AllowedMimeType, { offset: number; bytes: number[] }[]>> = {
  "image/png": [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  // JPEG has several encoder-specific fourth bytes (JFIF/Exif/raw); the SOI
  // marker plus the first marker byte is the part every variant shares.
  "image/jpeg": [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  "image/gif": [
    { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
    { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
  ],
  // RIFF container: "RIFF" at 0, 4-byte little-endian length, then "WEBP".
  // Both halves are needed — "RIFF" alone is also a .wav.
  "image/webp": [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
  "application/pdf": [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }], // %PDF-
};

/**
 * Types with no magic number, verified by decoding instead.
 *
 * CSV, plain text, markdown and JSON are all just text — there is nothing to
 * sniff. Strict UTF-8 decoding is the available check, and it is a real one:
 * it rejects the arbitrary binary someone would have to smuggle in to make a
 * "text/csv" upload dangerous.
 */
const TEXT_TYPES = new Set<string>(["text/csv", "text/plain", "text/markdown", "application/json"]);

export type RejectionCode =
  | "unsupported-type"
  | "content-mismatch"
  | "too-large"
  | "empty"
  | "missing-filename"
  | "filename-too-long"
  | "missing-todo-id"
  | "missing-attachment-id";

export class AttachmentRejected extends Error {
  constructor(
    readonly code: RejectionCode,
    message: string,
  ) {
    super(message);
    this.name = "AttachmentRejected";
  }
}

function matches(bytes: Uint8Array, signature: { offset: number; bytes: number[] }): boolean {
  if (bytes.length < signature.offset + signature.bytes.length) return false;
  return signature.bytes.every((byte, i) => bytes[signature.offset + i] === byte);
}

/**
 * Confirms the bytes are really the declared type.
 *
 * Every signature listed for a type must match, not just one of them —
 * `image/webp` needs both halves of its RIFF header. Alternate encodings of
 * the SAME format (GIF87a vs GIF89a) are therefore modelled as one entry
 * each and short-circuited below.
 */
function contentMatchesType(bytes: Uint8Array, mimeType: AllowedMimeType): boolean {
  if (TEXT_TYPES.has(mimeType)) {
    try {
      // `ignoreBOM: false` is the default everywhere; it is spelled out only
      // because the worker's `TextDecoderConstructorOptions` requires both
      // fields rather than treating them as optional.
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
      return true;
    } catch {
      return false;
    }
  }

  const signatures = MAGIC_NUMBERS[mimeType];
  // An allow-listed type with neither a signature nor a text rule would sail
  // through unchecked. Fail closed instead — this is only reachable by adding
  // to ALLOWED_MIME_TYPES and forgetting the other half.
  if (!signatures) return false;

  if (mimeType === "image/gif") return signatures.some((signature) => matches(bytes, signature));
  return signatures.every((signature) => matches(bytes, signature));
}

/**
 * Strips anything that could make a filename mean something to a filesystem
 * or a header parser.
 *
 * This value is NEVER used to build an R2 key (`storage.ts` derives that from
 * ids alone), so path traversal is not the live risk — header injection into
 * `Content-Disposition` is. Control characters, quotes and backslashes go;
 * separators collapse to `_` so the result still reads like the original.
 */
export function sanitizeFilename(raw: string): string {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f"\\]/g, "").replace(/[/\\]+/g, "_").trim();
  return cleaned.slice(0, MAX_FILENAME_LENGTH);
}

export interface ValidatedUpload {
  filename: string;
  mimeType: AllowedMimeType;
  byteSize: number;
}

/**
 * The one gate every upload passes. Throws `AttachmentRejected`; the route
 * maps the code to a status.
 *
 * Size is checked BEFORE content so an oversized file gets the accurate
 * error rather than "content-mismatch" from a truncated read.
 */
export function validateUpload(
  bytes: Uint8Array,
  declaredType: string,
  rawFilename: string | null,
  isOwner: boolean,
): ValidatedUpload {
  const filename = sanitizeFilename(rawFilename ?? "");
  if (!filename) throw new AttachmentRejected("missing-filename", "a filename is required");

  if (bytes.byteLength === 0) throw new AttachmentRejected("empty", "the file is empty");

  const cap = isOwner ? MAX_OWNER_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES;
  if (bytes.byteLength > cap) {
    throw new AttachmentRejected(
      "too-large",
      `the file is ${bytes.byteLength} bytes; the limit is ${cap}`,
    );
  }

  // `text/csv; charset=utf-8` — the parameters are the browser's business,
  // not ours.
  const mimeType = declaredType.split(";")[0].trim().toLowerCase();
  if (!isAllowedMimeType(mimeType)) {
    throw new AttachmentRejected(
      "unsupported-type",
      `${mimeType || "(none)"} is not one of ${ALLOWED_MIME_TYPES.join(", ")}`,
    );
  }

  if (!contentMatchesType(bytes, mimeType)) {
    throw new AttachmentRejected(
      "content-mismatch",
      `the file's contents are not ${mimeType}`,
    );
  }

  return { filename, mimeType, byteSize: bytes.byteLength };
}
