/**
 * How much of a to-do's title is shown before it is cut off.
 *
 * Two surfaces have to agree on this number — the card clamps to it, and the
 * detail sheet's title field grows to it — and they express it in different
 * units, so the number lives here rather than in either component. The class
 * name is spelled out rather than built from `TITLE_LINES`, because Tailwind
 * scans source text for utilities and silently drops anything it cannot see
 * literally.
 *
 * This is the shape of a future preference: local-only and unsynced, like the
 * theme mirror in `lib/theme.ts`. Changing it here changes both surfaces.
 */
export const TITLE_LINES = 3;

/** The card's clamp. Must stay in sync with `TITLE_LINES`. */
export const TITLE_CLAMP_CLASS = "line-clamp-3";
