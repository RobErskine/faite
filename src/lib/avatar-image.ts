/**
 * Turns an uploaded photo into a small data URL that fits in a settings row.
 *
 * Client-only (canvas, createImageBitmap) — deliberately NOT reachable from
 * lib/schema.ts, unlike lib/theme.ts and lib/profile.ts. The alternative to
 * downscaling is a Blob in a new Dexie table, which needs a schema version
 * bump, object-URL lifecycle management, and a second sync path outside the
 * outbox. A 256px WebP lands around 8-15 KB — small enough to live in the
 * settings row like every other preference, so it syncs through the channel
 * that already exists.
 */

const MAX_DIMENSION = 256;
const QUALITY = 0.8;
/** Hard cap so a pathological image can't bloat the settings row or outbox. */
const MAX_BYTES = 64 * 1024;

export class AvatarImageTooLargeError extends Error {
  constructor() {
    super("That image is too large even after compression. Try a smaller photo.");
    this.name = "AvatarImageTooLargeError";
  }
}

/** Center-crops to square, downscales, and encodes as a WebP data URL. */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const size = Math.min(MAX_DIMENSION, side);

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);

    const dataUrl = canvas.toDataURL("image/webp", QUALITY);
    if (dataUrl.length > MAX_BYTES) throw new AvatarImageTooLargeError();
    return dataUrl;
  } finally {
    bitmap.close();
  }
}
