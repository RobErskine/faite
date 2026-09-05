import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
  IBM_Plex_Mono,
  Source_Sans_3,
  Source_Serif_4,
} from "next/font/google";

/**
 * Every font family the app can render, declared once.
 *
 * Five families cost almost nothing at runtime: only the DEFAULT pairing sets
 * `preload`, and a browser will not download a declared `@font-face` until CSS
 * actually applies it. Switching pairings fetches the new files on demand; the
 * others never leave the CDN for most users.
 *
 * Each family exposes a CSS variable. `globals.css` maps those onto four ROLE
 * tokens (sans / heading / mono / numeric) per pairing, so components reference
 * roles and never a specific family.
 *
 * Two pairings since the V milestone (docs/DESIGN.md §2): Editorial (default)
 * and Hyperlegible. Inter, JetBrains Mono and IBM Plex Sans were removed with
 * the Precision and Systematic pairings.
 */

// --- Editorial (default) ---------------------------------------------------
// Source Serif for headings, Source Sans for body, Plex Mono for numerals. The
// only pairing that preloads: it is the first impression for a new account.

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  display: "swap",
  // Optical-size axis; `font-optical-sizing: auto` in globals.css engages it,
  // which is what keeps a serif readable at column-title sizes.
  axes: ["opsz"],
});

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  display: "swap",
});

// Not a variable font, so weights are explicit. These three cover every
// `font-normal` / `font-medium` / `font-semibold` in the app.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
});

// --- Hyperlegible ----------------------------------------------------------
// Braille Institute, purpose-designed for maximum character disambiguation
// for low-vision readers. Fetched on demand when chosen.

/*
 * These two are newer than the font metrics Next bundles, so it cannot generate
 * a size-adjusted fallback face for them and says so at build time. An
 * explicit `fallback` at least pins which face fills the gap instead of
 * leaving it to the UA default.
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
  preload: false,
  fallback: ["ui-sans-serif", "system-ui", "arial"],
});

const atkinsonMono = Atkinson_Hyperlegible_Mono({
  variable: "--font-atkinson-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  fallback: ["ui-monospace", "SFMono-Regular", "monospace"],
});

/** All font CSS variables, for the `<html>` className. */
export const fontVariables = [
  sourceSerif.variable,
  sourceSans.variable,
  plexMono.variable,
  atkinson.variable,
  atkinsonMono.variable,
].join(" ");

/*
 * The pairing ids, labels, and default live in `@/lib/fonts` — that module is
 * dependency-free so `lib/schema.ts` can reach it without dragging `next/font`
 * into the Worker build.
 */
