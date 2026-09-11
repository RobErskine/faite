/**
 * The event-kind filters on the three timeline surfaces — the day sheet, the
 * global activity feed, and a to-do's History — store the kinds a user
 * HIDES, not the kinds they show (EI-320).
 *
 * The old fields (`visibleEventKinds`, `visibleActivityKinds`,
 * `visibleHistoryKinds`) stored the shown set. That made every kind added
 * after a user saved the filter invisible on their device, silently: the
 * stored array simply didn't name it. A server-side backfill could not fix
 * it either — an `UPDATE` inside a Durable Object migration allocates no
 * `version`, so `pull()` never sends the row to a device that already has it
 * (`docs/SCHEMA-CHANGES.md`, "Not built yet"). Migration 21 was exactly that.
 *
 * With a hidden set, "no opinion" means visible, and a new kind needs no
 * backfill ever again.
 *
 * The old arrays are converted WHEN READ, not by a one-time write: a
 * `hidden*` field that is `null` (or absent, on a Dexie row written before
 * it existed) has not been converted yet, and `resolveHiddenKinds` derives it
 * from the old visible array. The first toggle writes the hidden set through
 * `mutate()`, and from then on the old field is never read again. That needs
 * no client backfill ledger, works for a signed-out user with no Durable
 * Object, and is idempotent by construction.
 */

/**
 * Each surface's kinds, grouped by the release that added them, oldest
 * first. This is what lets `resolveHiddenKinds` tell "unchecked" from "did
 * not exist yet" — a kind is only counted as hidden if the user could have
 * seen it in the menu when they saved.
 *
 * These lists are history, not a registry: the old fields are never written
 * again, so a kind added from now on never needs to appear here.
 */
export type KindGenerations = readonly (readonly string[])[];

/**
 * The day sheet. The server column shipped with the first four (migration 7);
 * `rolledOver`/`overflowed` came with the Faite Loop (EI-96) and were never
 * appended to existing rows.
 */
export const DAY_SHEET_KIND_GENERATIONS: KindGenerations = [
  ["created", "scheduled", "done", "dropped"],
  ["rolledOver", "overflowed"],
];

/**
 * The global activity feed. Eleven kinds at launch (EI-238, migration 17);
 * `attached`/`detached` came with EI-318, whose server-side backfill
 * (migration 21) reached only devices that pulled the row fresh.
 */
export const ACTIVITY_KIND_GENERATIONS: KindGenerations = [
  [
    "created",
    "scheduled",
    "unscheduled",
    "moved",
    "done",
    "dropped",
    "reopened",
    "edited",
    "deleted",
    "rolledOver",
    "overflowed",
  ],
  ["attached", "detached"],
];

/** A to-do's History. Shipped with its whole vocabulary at once (EI-318). */
export const HISTORY_KIND_GENERATIONS: KindGenerations = [
  [
    "created",
    "scheduled",
    "unscheduled",
    "moved",
    "done",
    "dropped",
    "reopened",
    "edited",
    "deleted",
    "attached",
    "detached",
    "rolledOver",
    "overflowed",
  ],
];

/**
 * The kinds a user has hidden on one surface.
 *
 * - `hidden` set: it is the answer.
 * - `hidden` unset, no old `visible` array: nothing is hidden.
 * - `hidden` unset, old `visible` array present: hidden is every kind the
 *   user could have seen, minus what they kept. "Could have seen" is every
 *   generation up to the NEWEST one the array names — an array naming
 *   `rolledOver` was saved by a build that offered it, so leaving out
 *   `overflowed` there was a choice; an array naming neither might predate
 *   both, so neither is counted as hidden.
 */
export function resolveHiddenKinds(
  hidden: readonly string[] | null | undefined,
  legacyVisible: readonly string[] | null | undefined,
  generations: KindGenerations,
): string[] {
  if (hidden) return [...hidden];
  if (!legacyVisible) return [];

  let newest = 0;
  generations.forEach((generation, index) => {
    if (generation.some((kind) => legacyVisible.includes(kind))) newest = index;
  });
  const couldHaveSeen = generations.slice(0, newest + 1).flat();
  return couldHaveSeen.filter((kind) => !legacyVisible.includes(kind));
}

/** The hidden set after one menu checkbox changes. Order is not meaningful. */
export function toggleHiddenKind(
  hidden: readonly string[],
  kind: string,
  visible: boolean,
): string[] {
  const rest = hidden.filter((k) => k !== kind);
  return visible ? rest : [...rest, kind];
}
