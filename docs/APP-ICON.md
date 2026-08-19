# App icon — working document

**Self-contained handoff.** Everything needed to refine or regenerate Faite's
icon without re-deriving the pipeline. Shipped 2026-08-19 (commit `60343de`).

The icon is a single hand-drawn glyph (looks like a stylized "F"/infinity
loop) built in Linearity Curve. One source, one script, every derived asset
committed — never hand-edit a generated file.

---

## 1. Source of truth

`assets/icons/`:

| File | What |
|---|---|
| `icon.svg` | 1024×1024, full bleed, white background + black glyph. Feeds every raster surface that wants a solid backing (favicon.ico, apple-icon, PWA icons). |
| `icon-glyph.svg` | Same glyph, no background rect, fill left as the literal string `#000000`. Feeds every transparent/recolored surface — the generator does `readFileSync(...).replaceAll("#000000", color)` to retint it, so it is a template, not just artwork. |

**To refine the artwork:** edit both files, keeping the same `<path d="...">`
data in sync between them (glyph-only vs. glyph+bg is the only difference
that should exist). Then run `npm run icons` and re-verify per §6 below.

## 2. The generator — `npm run icons`

`scripts/icons/generate.mjs`. Plain ESM, no build step, same pattern as
`scripts/schema/*.mjs`. Requires `sharp` (declared `devDependency`) and the
`magick` CLI (ImageMagick — system dependency, not in `package.json`, used
only to assemble the multi-resolution `.ico`).

Six steps, each documented inline in the script itself — read it before
changing sizing/positioning logic rather than re-deriving from this doc,
since the numbers live there. Summary:

1. **Tab-icon SVGs** → `public/favicon/icon-{light,dark}{,-dev}.svg` — see §3.
2. **`src/app/favicon.ico`** — legacy fallback, 16/32/48px, always the
   black-on-white glyph (no dark/dev variant; old browsers that fall back to
   `.ico` don't do media queries either).
3. **`src/app/apple-icon.png`** — 180×180, opaque white background. iOS
   applies its own rounded mask and renders transparency as solid black, not
   clear, so this must be flattened.
4. **PWA icons** — `public/icon-{192,512}.png` (full bleed) and
   `public/icon-maskable-512.png` (glyph scaled to 68% of canvas height,
   white background). See §4 for why 68%.
5. **Tauri desktop source** — `assets/icons/generated/tauri-source.png`, a
   white rounded square (squircle) with transparent margin. See §5.
6. **`npx tauri icon`** on that source, regenerating all of
   `src-tauri/icons/` (`.icns`, `.ico`, Windows `Square*Logo` tiles). The
   script prunes the `ios/`, `android/`, and `64x64.png` output Tauri emits
   by default — this repo has no `tauri ios/android init` (mobile is
   Capacitor's job, see `docs/MOBILE.md`), so those would just be unused
   bloat if left in.

## 3. Favicon: env × theme, four SVGs

`public/favicon/` holds four transparent-background SVGs — glyph color is
the only difference between them:

| File | Color | When |
|---|---|---|
| `icon-light.svg` | `#000000` | production, light OS/browser theme |
| `icon-dark.svg` | `#ffffff` | production, dark OS/browser theme |
| `icon-light-dev.svg` | `#f59e0b` (amber-500) | dev/preview, light theme |
| `icon-dark-dev.svg` | `#fbbf24` (amber-400) | dev/preview, dark theme |

Wired in `src/app/layout.tsx`'s `metadata.icons.icon` array — **not** the
`src/app/icon.svg` file convention, because that convention supports exactly
one static file, and this needs four selected by two independent axes:

- **Light/dark** — the standard `<link rel="icon" media="...">` attribute.
  The browser switches the visible favicon live as the OS theme changes; no
  JS involved.
- **Dev/prod** — `process.env.NEXT_PUBLIC_APP_ENV === "development"` picks
  the file at build time. The var is set only by the `dev` and `preview` npm
  scripts (`package.json`), so a real localhost or `npm run preview` tab
  renders amber and everything else (prod build, static export) renders
  black/white — the environment is visible at a glance in the tab strip.
  Must be referenced as a literal `process.env.NEXT_PUBLIC_APP_ENV` (not
  destructured) for Next to inline it at build time — same requirement
  `NEXT_PUBLIC_AGENTATION` documents a few lines below it in that file.

**Why not request-time hostname detection** (the pattern
`src/lib/api-origin.ts` uses for the auth API origin)? Root layout metadata
is evaluated statically, and reading the real request host would require
`generateMetadata()` calling `headers()`, which forces dynamic rendering —
not available under `output: "export"` (`npm run build:static`, the
Capacitor guard, AGENTS.md). A build-time env var is the only option that
survives static export.

**Gotcha:** setting `metadata.icons.icon` explicitly opts Next out of
*automatic* file-convention icon detection for the whole `icons` field
(`favicon.ico` is the one exception — a separate mechanism entirely). That's
why `metadata.icons.apple: "/apple-icon.png"` is also spelled out by hand in
`layout.tsx` — without it, `src/app/apple-icon.png` stops being linked even
though the file (and its route) still exists.

## 4. Maskable icon math

Android's adaptive-icon safe zone is a centered circle at 80% of the canvas
diameter. The glyph is scaled to **68% of canvas height** before compositing
onto `public/icon-maskable-512.png` — a full-bleed glyph gets clipped by the
mask on Android home screens. If the artwork's aspect ratio changes
significantly, re-check that 68% still clears the circle with margin (the
generator's `glyphOnCanvas()` trims transparent margin via `sharp().trim()`
before scaling, so it adapts to the actual glyph bounding box automatically —
you shouldn't need to hand-tune the fraction unless the glyph gets much
wider/shorter relative to its height).

## 5. Desktop (Tauri) squircle

macOS renders app icons inset inside a rounded square with a transparent
margin around it — a full-bleed flat tile looks wrong in the Dock next to
every other app. `tauri icon` only resizes whatever source you give it; it
applies no rounding of its own. So the generator builds the rounded square
itself: 1024 canvas, white rounded square at ~80% of the canvas (10% inset
each side), corner radius ~22.4% of the square's side (macOS's own
convention), glyph composited at 62% of canvas.

**Trade-off, accepted deliberately (see prior plan discussion):** Tauri feeds
this one source to every platform, so Windows' `Square*Logo` tiles inherit
the same transparent corners/margin, which isn't the native Windows tile
convention. macOS is the actual shipping target right now (`docs/DESKTOP.md`
§1 — "Native macOS (then Windows)"), so this was chosen over the reverse
(flat full-bleed square: correct on Windows, looks like an unrounded sticker
in the macOS Dock). Revisit if/when Windows ships for real.

## 6. Verification after any change

- `npm run icons`, then `magick identify` the outputs — confirm dimensions
  and that `apple-icon.png` has no alpha channel (`magick identify -verbose
  src/app/apple-icon.png | grep Alpha` should show nothing / not "Yes").
- `npm run dev` (renders the `-dev` amber variant) and `npm run build &&
  npm run start` or just inspect `next build`'s route list (view source on
  `/`, expect `rel="icon" type="image/svg+xml"` ×2 with `media` attributes,
  `rel="apple-touch-icon"`, and the `favicon.ico` fallback).
- DevTools → Application → Manifest — all three PWA icons should preview
  with no warnings, one marked `maskable`.
- `npx playwright test e2e/foundations.spec.ts --project=desktop
  --project=phone-iphone` — asserts the manifest has ≥3 icons including one
  `maskable` entry; doesn't assert pixel content, so it won't catch a bad
  recolor/reposition, only a structurally broken manifest.
- `npm run build:static` — must stay green; this is the Capacitor CI gate
  and the icon changes touch files it renders.
- Desktop: after `npm run icons` regenerates `src-tauri/icons/`, `npx tauri
  dev` to eyeball the Dock icon, or `qlmanage -p src-tauri/icons/icon.icns`
  for a quick Quick Look preview of the squircle.
- Manual: add `/board` to an iPhone home screen and confirm the icon is the
  glyph, not a screenshot of the page.

## 7. Not done, and why

**Linear project icon** — intentionally left alone. Linear project icons are
one of ~70 built-in glyphs or an emoji code; there is no custom-image upload
path in either the API (`mcp__linear__save_project`'s `icon` param) or the
web UI's picker. If this changes on Linear's end, it's a manual one-off in
the Linear UI, not something this pipeline can produce.
