import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Inter,
  JetBrains_Mono,
  Source_Sans_3,
  Source_Serif_4,
} from "next/font/google";

/**
 * Every font family the app can render, declared once.
 *
 * Eight families sounds expensive but costs almost nothing at runtime: only the
 * DEFAULT pairing sets `preload`, and a browser will not download a declared
 * `@font-face` until CSS actually applies it. Switching pairings fetches the two
 * new files on demand; the other six never leave the CDN for most users.
 *
 * Each family exposes a CSS variable. `globals.css` maps those onto four ROLE
 * tokens (sans / heading / mono / numeric) per pairing, so components reference
 * roles and never a specific family.
 */

// --- Hyperlegible (default) ------------------------------------------------
// Braille Institute, engineered for maximum character disambiguation for
// low-vision readers. The only pairing that preloads.

/*
 * These two are newer than the font metrics Next bundles, so it cannot generate
 * a size-adjusted fallback face for them and says so at build time. The
 * consequence is a small layout shift if the fallback paints first — mitigated
 * by these being the only preloaded families, so they are normally ready before
 * first paint. An explicit `fallback` at least pins which face fills the gap
 * instead of leaving it to the UA default.
 *
 * The original `Atkinson_Hyperlegible` does have metrics, but ships static
 * 400/700 only; the board uses four weights, so the variable versions win.
 *
 * The fallback arrays are written out inline rather than shared via a const:
 * next/font parses these options at build time and rejects anything that is not
 * an explicit literal.
 */
const atkinson = Atkinson_Hyperlegible_Next({
  variable: "--font-atkinson",
  subsets: ["latin"],
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "arial"],
});

const atkinsonMono = Atkinson_Hyperlegible_Mono({
  variable: "--font-atkinson-mono",
  subsets: ["latin"],
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "monospace"],
});

// --- Precision -------------------------------------------------------------

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  // Inter's optical-size axis; `font-optical-sizing: auto` in globals.css
  // engages it, which is what keeps it readable down at badge sizes.
  axes: ["opsz"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

// --- Systematic ------------------------------------------------------------

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

// Not a variable font, so weights are explicit. These three cover every
// `font-normal` / `font-medium` / `font-semibold` in the app.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  weight: ["400", "500", "600"],
});

// --- Editorial -------------------------------------------------------------
// Reuses Plex Mono for numerals, so it costs one extra family, not two.

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  axes: ["opsz"],
});

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

/** All font CSS variables, for the `<html>` className. */
export const fontVariables = [
  atkinson.variable,
  atkinsonMono.variable,
  inter.variable,
  jetbrainsMono.variable,
  plexSans.variable,
  plexMono.variable,
  sourceSerif.variable,
  sourceSans.variable,
].join(" ");

/*
 * The pairing ids, labels, and default live in `@/lib/fonts` — that module is
 * dependency-free so `lib/schema.ts` can reach it without dragging `next/font`
 * into the Worker build.
 */
