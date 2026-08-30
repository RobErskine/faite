import { SITE_ORIGIN } from "@/lib/site";

/**
 * The build-version check the desktop shell performs against the server —
 * EI-147, and deliberately the CHEAP half of the desktop update story.
 *
 * The expensive half (`plugin-updater` + a minisign keypair + a tag → sign →
 * notarize → publish pipeline, EI-134/EI-136) downloads and installs a new
 * build in place. This does not: it asks the server what the newest build is,
 * compares that to the running one, and — when the running one is too old —
 * says so and opens the download page in the system browser. The user
 * installs it themselves.
 *
 * **It is worth shipping before the updater exists specifically because a
 * client that never learned to ask can never be told.** The desktop bundle is
 * a frozen static export (decision #2, docs/DESKTOP.md §2): a web deploy
 * cannot reach it, so the day a server change stops supporting an old client
 * is the day that client syncs silently wrong forever — unless it was already
 * in the habit of asking. Every policy decision after that (which version is
 * newest, which is the floor, where the download lives) is data the SERVER
 * sends, so it can change with no client release. That is the whole design.
 *
 * Shared by the client and the Worker, same as `src/lib/sync/wire.ts`: the
 * server builds the payload this file's `parseVersionPolicy` reads back, so
 * the two halves cannot drift into different shapes. Pure for the same
 * reason `wire.ts` is — the Worker program has no `window`, so the actual
 * `fetch` lives with its one caller in `use-desktop-update.ts`.
 */

export interface DesktopVersionPolicy {
  /** Newest published build. Below it → "an update is available". */
  latest: string;
  /** Oldest build still supported. Below it → the app is out of service. */
  minimum: string;
  /** Where a human goes to get `latest`. Always on `SITE_ORIGIN` — see below. */
  downloadUrl: string;
}

export type DesktopUpdateState =
  | { status: "current" }
  | { status: "outdated"; installed: string; latest: string; downloadUrl: string }
  | { status: "blocked"; installed: string; latest: string; downloadUrl: string };

/**
 * `0.2.0` → `[0, 2, 0]`, or `null` for anything this can't read as a version.
 *
 * A leading `v` and everything from the first `-`/`+` (semver's pre-release
 * and build metadata) are dropped, so `v0.2.0-beta.1` compares equal to
 * `0.2.0`. That is a deliberate simplification, not an oversight: this app's
 * versions come from `src-tauri/tauri.conf.json`, which macOS itself requires
 * to be a plain dotted-numeric `CFBundleShortVersionString`. Ranking beta
 * builds against their release would be machinery for a case the bundle
 * format cannot produce.
 */
function parseVersion(version: string): number[] | null {
  const core = version.trim().replace(/^v/i, "").split(/[-+]/)[0];
  if (!/^\d+(\.\d+)*$/.test(core)) return null;
  return core.split(".").map(Number);
}

/**
 * `< 0` when `a` is older, `0` when equal, `> 0` when newer — and `null` when
 * either side isn't a version at all. Missing trailing segments count as 0, so
 * `0.2` and `0.2.0` are the same version.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;

  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The one decision this feature makes, kept pure so it is tested without a
 * webview, a network, or a clock.
 *
 * **An unreadable version reports `current`.** A blocked app is a bricked app
 * — no sync, a red bar it cannot dismiss — and the only inputs are two strings
 * from a config file and one HTTP response. If either fails to parse, the
 * cause is a typo in a constant, not a genuinely obsolete client, and the
 * right failure is "do nothing" rather than "take the app away". Same reason
 * `useDesktopUpdate` treats a failed fetch as `current` instead of retrying
 * into a block.
 */
export function evaluateUpdate(
  installed: string,
  policy: DesktopVersionPolicy,
): DesktopUpdateState {
  const details = {
    installed,
    latest: policy.latest,
    downloadUrl: policy.downloadUrl,
  };

  const belowMinimum = compareVersions(installed, policy.minimum);
  if (belowMinimum !== null && belowMinimum < 0) return { status: "blocked", ...details };

  const belowLatest = compareVersions(installed, policy.latest);
  if (belowLatest !== null && belowLatest < 0) return { status: "outdated", ...details };

  return { status: "current" };
}

/**
 * Reads a `/api/desktop/version` body back, or `null` if it isn't one.
 *
 * `downloadUrl` is checked against `SITE_ORIGIN` rather than merely being a
 * string, because this value's whole purpose is to be handed to the system
 * browser. Tauri's capability allow-list (`src-tauri/capabilities/default.json`)
 * already refuses `opener:allow-open-url` for anything off `https://myfaite.app`,
 * so an off-origin URL could only ever fail — checking here turns that into a
 * clean "no update banner" instead of a rejected `invoke` at click time.
 * Pointing downloads somewhere else later means widening BOTH lists, on
 * purpose.
 */
export function parseVersionPolicy(body: unknown): DesktopVersionPolicy | null {
  if (!body || typeof body !== "object") return null;
  const { latest, minimum, downloadUrl } = body as Record<string, unknown>;
  if (typeof latest !== "string" || typeof minimum !== "string") return null;
  if (typeof downloadUrl !== "string" || !downloadUrl.startsWith(`${SITE_ORIGIN}/`)) return null;
  return { latest, minimum, downloadUrl };
}
