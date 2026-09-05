/**
 * Font pairing identifiers.
 *
 * Deliberately separate from `src/app/fonts.ts`, which imports
 * `next/font/google`. This module is reachable from `lib/schema.ts` and so ends
 * up in the Worker build (`tsconfig.worker.json`), where a `next/font` import
 * would not resolve. Keep this file free of dependencies.
 *
 * The ids are the values of `data-font` on `<html>`; `globals.css` has a
 * matching block for each.
 *
 * Two pairings, not four (docs/DESIGN.md §7, decision C): one stylised, one
 * clear. `precision` (Inter + JetBrains Mono) and `systematic` (IBM Plex) were
 * removed in the V milestone; see `normalizeFontPairing` for how a stored value
 * naming one of them is handled.
 */

export const FONT_PAIRINGS = [
  {
    id: "editorial",
    label: "Editorial",
    description: "Source Serif + Source Sans — warmer, editorial headings",
  },
  {
    id: "hyperlegible",
    label: "Hyperlegible",
    description: "Atkinson Hyperlegible — built for maximum character clarity",
  },
] as const;

export type FontPairingId = (typeof FONT_PAIRINGS)[number]["id"];

/** Non-empty tuple, which is the shape `z.enum` wants. */
export const FONT_PAIRING_IDS = FONT_PAIRINGS.map((p) => p.id) as unknown as [
  FontPairingId,
  ...FontPairingId[],
];

/**
 * Editorial, for new accounts (docs/DESIGN.md §7, decision D). Existing rows
 * carry their own value and are untouched by this constant.
 */
export const DEFAULT_FONT_PAIRING: FontPairingId = "editorial";

/**
 * Coerces anything to a pairing this build can render.
 *
 * The setting syncs across devices and old rows still say `precision` or
 * `systematic`. Cutting those from the enum would make such a row fail to
 * parse — and a settings row that fails to parse takes the whole board down
 * with it. So the read side tolerates them: an unknown id renders as the
 * default rather than as a parse error. Mirrors `normalizeTheme()` in
 * `lib/theme.ts`, which exists for the same reason (rows older than the field).
 *
 * Read-time only, deliberately. The stored value is left alone so a device on
 * an older build keeps seeing the pairing it chose; nothing here writes back.
 */
export function normalizeFontPairing(value: unknown): FontPairingId {
  return (FONT_PAIRING_IDS as readonly string[]).includes(value as string)
    ? (value as FontPairingId)
    : DEFAULT_FONT_PAIRING;
}

/**
 * localStorage mirror of the stored setting.
 *
 * The setting of record is in IndexedDB, which only resolves after hydration.
 * The inline script in the root layout reads this key synchronously so the
 * right pairing is applied before first paint.
 */
export const FONT_STORAGE_KEY = "faite:font";
