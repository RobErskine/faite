/**
 * The accent palette.
 *
 * These are the first chromatic values in the app — globals.css is entirely
 * `oklch(L 0 0)`, deliberately. So rather than introduce a parallel token set
 * for one accent, colors are stored on the record as plain hex and applied
 * inline, the way label chips already do it (components/board/todo-card.tsx).
 *
 * Hex specifically, not oklch: tints are produced by appending an alpha pair
 * (`#e54d2e` + `20` ≈ 12%), which is the convention already in use and only
 * works on hex.
 *
 * The ten presets are Radix Colors' step 9 — the step designed for solid fills,
 * tuned to hold roughly equal weight against both a light and a dark backdrop.
 * That matters here because the app ships both themes and a tab color has to
 * read in either without a per-theme variant.
 */

export interface AccentColor {
  name: string;
  value: string;
}

export const ACCENT_COLORS: readonly AccentColor[] = [
  { name: "Tomato", value: "#e54d2e" },
  { name: "Orange", value: "#f76b15" },
  { name: "Amber", value: "#ffb224" },
  { name: "Grass", value: "#46a758" },
  { name: "Teal", value: "#12a594" },
  { name: "Cyan", value: "#00a2c7" },
  { name: "Blue", value: "#3e63dd" },
  { name: "Violet", value: "#6e56cf" },
  { name: "Plum", value: "#ab4aba" },
  { name: "Pink", value: "#d6409f" },
] as const;

/** Alpha suffixes for the three tint strengths the UI uses. */
const WASH_ALPHA = "1a"; // ~10% — a field behind a run of rows
const TINT_ALPHA = "20"; // ~12% — fills behind text
const EDGE_ALPHA = "59"; // ~35% — borders and rules

/**
 * True for a value this module can safely append an alpha pair to.
 *
 * Anything else — a color from a future picker, a corrupted row, a synced
 * value from a client that stored oklch — is rejected rather than concatenated
 * into a string that is not a color at all. `#rgb` shorthand is excluded on
 * purpose: `#abc20` is not a valid color.
 */
export function isTintableColor(color: string | null | undefined): color is string {
  return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color);
}

/** A faint wash of the color, for fills behind text. */
export function tint(color: string | null | undefined): string | undefined {
  return isTintableColor(color) ? `${color}${TINT_ALPHA}` : undefined;
}

/** A stronger wash, for borders and underlines. */
export function edge(color: string | null | undefined): string | undefined {
  return isTintableColor(color) ? `${color}${EDGE_ALPHA}` : undefined;
}

/**
 * The faintest of the three: a field behind a run of stacked rows.
 *
 * Weaker than `tint()` because it covers area rather than a chip. At 12% behind
 * five card rows a step-9 hue reads as a colored panel competing with the
 * priority rail for attention; at 10% it reads as membership, which is the whole
 * job. It also has to sit UNDER `hover:bg-accent/50` and still leave that hover
 * perceptible.
 */
export function wash(color: string | null | undefined): string | undefined {
  return isTintableColor(color) ? `${color}${WASH_ALPHA}` : undefined;
}
