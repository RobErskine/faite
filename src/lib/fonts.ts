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
 */

export const FONT_PAIRINGS = [
  {
    id: "hyperlegible",
    label: "Hyperlegible",
    description: "Atkinson Hyperlegible — built for maximum character clarity",
  },
  {
    id: "precision",
    label: "Precision",
    description: "Inter + JetBrains Mono — crisp at small sizes",
  },
  {
    id: "systematic",
    label: "Systematic",
    description: "IBM Plex — one superfamily, perfectly matched figures",
  },
  {
    id: "editorial",
    label: "Editorial",
    description: "Source Serif + Source Sans — warmer, editorial headings",
  },
] as const;

export type FontPairingId = (typeof FONT_PAIRINGS)[number]["id"];

/** Non-empty tuple, which is the shape `z.enum` wants. */
export const FONT_PAIRING_IDS = FONT_PAIRINGS.map((p) => p.id) as unknown as [
  FontPairingId,
  ...FontPairingId[],
];

export const DEFAULT_FONT_PAIRING: FontPairingId = "hyperlegible";

/**
 * localStorage mirror of the stored setting.
 *
 * The setting of record is in IndexedDB, which only resolves after hydration.
 * The inline script in the root layout reads this key synchronously so the
 * right pairing is applied before first paint.
 */
export const FONT_STORAGE_KEY = "faite:font";
