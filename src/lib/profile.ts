/**
 * Avatar/identity resolution.
 *
 * Same discipline as `lib/fonts.ts` and `lib/theme.ts`: reachable from
 * `lib/schema.ts`, so no imports and — because `tsconfig.worker.json` compiles
 * with `lib: ["esnext"]` — no DOM types. `Intl` is fine; `window`/`document`
 * are not.
 */

export const AVATAR_KINDS = [
  { id: "initials", label: "Initials" },
  { id: "emoji", label: "Emoji" },
  { id: "image", label: "Photo" },
] as const;

export type AvatarKind = (typeof AVATAR_KINDS)[number]["id"];

/** Non-empty tuple, which is the shape `z.enum` wants. */
export const AVATAR_KIND_IDS = AVATAR_KINDS.map((k) => k.id) as unknown as [
  AvatarKind,
  ...AvatarKind[],
];

export const DEFAULT_AVATAR_KIND: AvatarKind = "initials";

/**
 * Placeholder identity until P2 auth lands. Moved here from app-header.tsx so
 * both the header and the profile settings section can fall back to it.
 */
export const PLACEHOLDER_NAME = "Local User";

/** First letter of the first two words, uppercased — "Local User" -> "LU". */
export function deriveInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * The first user-perceived character of a string.
 *
 * A plain `str[0]` or `str.slice(0, 2)` slices UTF-16 code units, which
 * shatters anything built from a ZWJ sequence — a family emoji, a flag, a
 * skin-toned emoji — into mojibake. `Intl.Segmenter` in "grapheme" mode knows
 * where those sequences actually end.
 */
export function firstGrapheme(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const first = segmenter.segment(trimmed)[Symbol.iterator]().next();
  return first.done ? "" : first.value.segment;
}

/** The subset of Settings this module reads. Avoids importing lib/schema.ts. */
export interface ProfileFields {
  displayName?: string;
  avatarKind?: string;
  avatarInitials?: string;
  avatarEmoji?: string;
  avatarImage?: string;
}

export interface ResolvedAvatar {
  name: string;
  kind: AvatarKind;
  initials: string;
  emoji: string;
  imageSrc: string;
}

/**
 * The single read path for identity, applying every fallback in one place:
 * empty display name, empty initials, an unrecognized avatar kind. Settings
 * rows written before these fields existed have none of them, and
 * `useSettings()` hands back the raw Dexie row rather than a schema-parsed
 * one, so every consumer must go through this rather than reading the fields
 * directly.
 */
export function resolveAvatar(settings: ProfileFields | undefined): ResolvedAvatar {
  const name = settings?.displayName?.trim() || PLACEHOLDER_NAME;
  const kind = (AVATAR_KIND_IDS as readonly string[]).includes(
    settings?.avatarKind ?? "",
  )
    ? (settings!.avatarKind as AvatarKind)
    : DEFAULT_AVATAR_KIND;
  const initials = settings?.avatarInitials?.trim() || deriveInitials(name);

  return {
    name,
    kind,
    initials,
    emoji: settings?.avatarEmoji?.trim() ?? "",
    imageSrc: settings?.avatarImage?.trim() ?? "",
  };
}
