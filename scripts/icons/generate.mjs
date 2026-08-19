#!/usr/bin/env node
// Regenerates every derived icon asset from assets/icons/{icon,icon-glyph}.svg.
// Run with `npm run icons` after editing the source artwork. Requires `sharp`
// (declared dependency) and the `magick` CLI (ImageMagick, system dependency,
// used only to assemble the multi-resolution favicon.ico).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const ASSETS = path.join(ROOT, "assets/icons");
const fullSvg = readFileSync(path.join(ASSETS, "icon.svg"));
const glyphTemplate = readFileSync(path.join(ASSETS, "icon-glyph.svg"), "utf8");

const glyphSvg = (color) => Buffer.from(glyphTemplate.replaceAll("#000000", color));

/** Renders the glyph, autocrops the transparent margin, and scales it so its
 * longest side is `fraction` of `canvas`, then composites it centered onto a
 * `canvas`x`canvas` square (optionally with a solid background). */
async function glyphOnCanvas({ color, canvas, fraction, background }) {
  const rendered = await sharp(glyphSvg(color))
    .resize(canvas * 2, canvas * 2, { fit: "contain" })
    .png()
    .toBuffer();
  const trimmed = await sharp(rendered).trim().toBuffer();
  const { width, height } = await sharp(trimmed).metadata();
  const scale = (canvas * fraction) / Math.max(width, height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const glyph = await sharp(trimmed).resize(w, h).toBuffer();
  return sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: glyph, left: Math.round((canvas - w) / 2), top: Math.round((canvas - h) / 2) }])
    .png();
}

async function main() {
  // 1. Tab-icon SVGs — transparent background, recolored per env x OS theme.
  // Next's metadata `icons.icon` array (src/app/layout.tsx) picks between
  // these via `media` (light/dark) and `NEXT_PUBLIC_APP_ENV` (dev/prod), so
  // the running environment is visible at a glance in the tab strip.
  const faviconDir = path.join(ROOT, "public/favicon");
  mkdirSync(faviconDir, { recursive: true });
  const variants = [
    ["icon-light.svg", "#000000"], // prod, light OS/browser theme
    ["icon-dark.svg", "#ffffff"], // prod, dark OS/browser theme
    ["icon-light-dev.svg", "#f59e0b"], // dev, light theme (amber-500)
    ["icon-dark-dev.svg", "#fbbf24"], // dev, dark theme (amber-400)
  ];
  for (const [file, color] of variants) {
    writeFileSync(path.join(faviconDir, file), glyphSvg(color));
  }

  // 2. favicon.ico — legacy fallback, always the prod/light glyph on white,
  // since old browsers/shortcuts that fall back to it don't do media queries.
  const tmp = mkdtempSync(path.join(tmpdir(), "faite-icons-"));
  const icoSizes = [16, 32, 48];
  const icoPngs = await Promise.all(
    icoSizes.map(async (size) => {
      const file = path.join(tmp, `favicon-${size}.png`);
      await sharp(fullSvg).resize(size, size).png().toFile(file);
      return file;
    }),
  );
  execFileSync("magick", [...icoPngs, path.join(ROOT, "src/app/favicon.ico")]);
  rmSync(tmp, { recursive: true, force: true });

  // 3. apple-icon.png — iOS home screen. Opaque: iOS composites its own
  // rounded mask, and transparency there renders as black, not clear.
  await sharp(fullSvg).resize(180, 180).flatten({ background: "#ffffff" }).png().toFile(
    path.join(ROOT, "src/app/apple-icon.png"),
  );

  // 4. PWA icons (public/, referenced from src/app/manifest.ts).
  await sharp(fullSvg).resize(192, 192).png().toFile(path.join(ROOT, "public/icon-192.png"));
  await sharp(fullSvg).resize(512, 512).png().toFile(path.join(ROOT, "public/icon-512.png"));

  // Maskable: Android's adaptive-icon safe zone is a centered circle at 80%
  // of the canvas diameter, so the glyph is scaled to 68% of canvas height to
  // clear it with margin — a full-bleed glyph gets clipped on Android.
  const maskable = await glyphOnCanvas({
    color: "#000000",
    canvas: 512,
    fraction: 0.68,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  });
  await maskable.toFile(path.join(ROOT, "public/icon-maskable-512.png"));

  // 5. Tauri desktop source — a white rounded square (macOS's own icon
  // convention: ~22.4% corner radius) with transparent margin, glyph at 62%.
  // `npx tauri icon` only resizes; it does not apply any rounding itself.
  mkdirSync(path.join(ASSETS, "generated"), { recursive: true });
  const squircleSize = 1024;
  const squircleInset = Math.round(squircleSize * 0.1);
  const squircleSide = squircleSize - squircleInset * 2;
  const squircleRadius = Math.round(squircleSide * 0.224);
  const squircleSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${squircleSize}" height="${squircleSize}">` +
      `<rect x="${squircleInset}" y="${squircleInset}" width="${squircleSide}" height="${squircleSide}" ` +
      `rx="${squircleRadius}" fill="#ffffff"/></svg>`,
  );
  const glyphForSquircle = await glyphOnCanvas({ color: "#000000", canvas: squircleSize, fraction: 0.62 });
  const glyphForSquircleBuf = await glyphForSquircle.toBuffer();
  await sharp(squircleSvg)
    .composite([{ input: glyphForSquircleBuf }])
    .png()
    .toFile(path.join(ASSETS, "generated/tauri-source.png"));

  // 6. Feed the squircle into Tauri's own icon generator for every desktop
  // platform size (.icns, .ico, Windows Square*Logo tiles). It also emits
  // iOS/Android sets and a stray 64x64.png regardless of target — this repo
  // only ships macOS/Windows (`tauri ios/android init` was never run, and
  // mobile is Capacitor's job, see docs/MOBILE.md), so those are pruned.
  const tauriIconsDir = path.join(ROOT, "src-tauri/icons");
  execFileSync("npx", ["tauri", "icon", path.join(ASSETS, "generated/tauri-source.png"), "-o", tauriIconsDir]);
  rmSync(path.join(tauriIconsDir, "ios"), { recursive: true, force: true });
  rmSync(path.join(tauriIconsDir, "android"), { recursive: true, force: true });
  rmSync(path.join(tauriIconsDir, "64x64.png"), { force: true });

  console.log("Icons regenerated.");
}

main();
