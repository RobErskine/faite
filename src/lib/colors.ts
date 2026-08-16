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

/**
 * The color a list actually renders in: its own, or its tab's when unset.
 *
 * A list is BORN colorless — `createList` writes `color: null` and nothing ever
 * assigns one — so inheritance is not an edge case, it is the common path. The
 * rule was inlined at five call sites before this existed, and `lib/board.ts`
 * was not one of them, which is exactly how a whole tab's worth of day-column
 * groups rendered grey while its pill and column headers rendered green.
 *
 * DERIVED, never stored. Recoloring a tab has to move every list still
 * inheriting from it, live — snapshotting the tab's color onto the record at
 * creation would freeze them and silently strand every list made before the
 * tab was colored.
 *
 * Structurally typed rather than taking `List`/`Tab`, so this module stays free
 * of schema imports and `lib/board.ts` — which builds groups from lists but has
 * no business importing the store — can call it too.
 *
 * `tabsById` should carry ARCHIVED tabs as well. Archiving a list leaves its
 * `tabId` intact (`repositories.ts` writes only `archivedAt`/`archivedWithTabId`),
 * so a list filed away with its tab still points at one that `useTabs()` filters
 * out — and a map of live tabs alone would drop its color.
 */
export function effectiveListColor(
  list: { color: string | null; tabId?: string | null } | null | undefined,
  tabsById: ReadonlyMap<string, { color: string | null }>,
): string | null {
  if (!list) return null;
  // Backlog is shared by every tab and so has no `tabId` — it inherits nothing,
  // which is right: there is no one tab whose color it could take.
  return list.color ?? (list.tabId ? (tabsById.get(list.tabId)?.color ?? null) : null);
}

/**
 * Alpha suffixes for the three tint strengths the UI uses.
 *
 * The three are a LADDER, and the gaps between them are the point: a rule at
 * 35%, the header it underlines at 12%, and the field behind the cards at 5%.
 * Wash and tint were 10% and 12% at first, two points apart, which is inside
 * the noise — the header and the run below it read as one flat panel of colour
 * rather than as a label above a field, and a 1px checkbox border sitting on
 * the field had nothing to separate it from.
 */
const WASH_ALPHA = "0d"; // ~5%  — a field behind a run of rows
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
 * priority rail for attention; the job is to say "these belong together", and
 * membership needs far less colour than a label does.
 *
 * Two things constrain how faint it can go, and 5% clears both: it must sit
 * UNDER `hover:bg-accent/50` and still leave that hover perceptible, and it
 * must stay clearly dimmer than the header's `tint()` above it, or the two
 * merge into one panel and the header stops reading as a header.
 */
export function wash(color: string | null | undefined): string | undefined {
  return isTintableColor(color) ? `${color}${WASH_ALPHA}` : undefined;
}
