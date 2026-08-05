/**
 * Appearance modes.
 *
 * Same discipline as `src/lib/fonts.ts`: reachable from `lib/schema.ts`, so no
 * imports and — because `tsconfig.worker.json` compiles with `lib: ["esnext"]`
 * — no DOM types either. `window` and `document` belong to the caller.
 *
 * "dark" here is the class name `globals.css`'s `dark` custom variant is built
 * on. Changing one means changing both.
 */

export const THEME_MODES = [
  { id: "light", label: "Light", description: "Always the light palette" },
  { id: "dark", label: "Dark", description: "Always the dark palette" },
  { id: "system", label: "System", description: "Follow the device setting" },
] as const;

export type ThemeMode = (typeof THEME_MODES)[number]["id"];

/** Non-empty tuple, which is the shape `z.enum` wants. */
export const THEME_MODE_IDS = THEME_MODES.map((t) => t.id) as unknown as [
  ThemeMode,
  ...ThemeMode[],
];

export const DEFAULT_THEME_MODE: ThemeMode = "system";

/**
 * localStorage mirror of the stored setting.
 *
 * The setting of record is in IndexedDB, which only resolves after hydration.
 * The inline script in the root layout reads this key synchronously so the
 * right palette is applied before first paint.
 */
export const THEME_STORAGE_KEY = "faite:theme";

/** Class toggled on <html>. `globals.css`'s `dark` custom variant targets it. */
export const DARK_CLASS = "dark";

export const PREFERS_DARK = "(prefers-color-scheme: dark)";

/**
 * Settings rows written before this field existed have no `theme` key at all,
 * and `useSettings()` hands back the raw Dexie row rather than a schema-parsed
 * one — so every read has to funnel through here.
 */
export function normalizeTheme(value: unknown): ThemeMode {
  return (THEME_MODE_IDS as readonly string[]).includes(value as string)
    ? (value as ThemeMode)
    : DEFAULT_THEME_MODE;
}

/**
 * "system" is not a value, it is a question. Resolving it is kept pure so the
 * interesting half is testable without a DOM.
 */
export function resolveTheme(
  mode: ThemeMode,
  prefersDark: boolean,
): "light" | "dark" {
  return mode === "system" ? (prefersDark ? "dark" : "light") : mode;
}
