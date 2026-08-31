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

/**
 * The hot-asset bundle currently published (EI-255), if there is one.
 *
 * This is the half of updating that does NOT need a new build: the frontend
 * ships as data, so a web deploy reaches an installed app. The shell around it
 * still only changes on a real release, which is what `minShellVersion`
 * guards — a bundle may call a Tauri command an older shell does not have, and
 * that shell has to refuse the bundle rather than boot into a broken board.
 *
 * `version` is a content hash from `scripts/desktop/bundle-assets.mjs`, not a
 * semver. It is compared for equality only, never ordered: "different from
 * what I am running" is the entire question. Shell versions remain semver and
 * remain ordered, which is why the two live in separate fields.
 */
export interface DesktopAssetBundle {
  /** Content hash identifying the published bundle. Equality, never order. */
  version: string;
  /** Lowest shell version that may activate this bundle. Semver, ordered. */
  minShellVersion: string;
  /** The per-file hash manifest. Always on `SITE_ORIGIN`. */
  manifestUrl: string;
  /** The `.tar.gz` itself. Always on `SITE_ORIGIN`. */
  archiveUrl: string;
}

export interface DesktopVersionPolicy {
  /** Newest published build. Below it → "an update is available". */
  latest: string;
  /** Oldest build still supported. Below it → the app is out of service. */
  minimum: string;
  /** Where a human goes to get `latest`. Always on `SITE_ORIGIN` — see below. */
  downloadUrl: string;
  /**
   * Absent whenever there is no bundle, or the server could not read the one
   * there is. Optional on purpose and in both directions: clients built before
   * EI-255 ignore it, and a client built after it must treat its absence as
   * "nothing to do" rather than an error.
   */
  assets?: DesktopAssetBundle;
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
  const { latest, minimum, downloadUrl, assets } = body as Record<string, unknown>;
  if (typeof latest !== "string" || typeof minimum !== "string") return null;
  if (typeof downloadUrl !== "string" || !downloadUrl.startsWith(`${SITE_ORIGIN}/`)) return null;

  const bundle = parseAssetBundle(assets);
  return bundle ? { latest, minimum, downloadUrl, assets: bundle } : { latest, minimum, downloadUrl };
}

/**
 * Reads the optional `assets` block, or `null` for anything malformed.
 *
 * **A bad block is dropped, not fatal.** The version check is the older and
 * more important of the two jobs this response does: it is what tells a
 * genuinely obsolete client to stop syncing. Letting a typo in the asset
 * fields take that down would trade a working safety mechanism for a broken
 * convenience, so the caller keeps the policy and simply sees no bundle.
 *
 * Both URLs are pinned to `SITE_ORIGIN` for the same reason `downloadUrl` is,
 * only more so: these are fetched and then *executed* as the app's own
 * frontend. An off-origin bundle URL is not a bundle from somewhere else, it
 * is someone else's application wearing this one's name.
 */
function parseAssetBundle(value: unknown): DesktopAssetBundle | null {
  if (!value || typeof value !== "object") return null;
  const { version, minShellVersion, manifestUrl, archiveUrl } = value as Record<string, unknown>;
  if (typeof version !== "string" || version.length === 0) return null;
  if (typeof minShellVersion !== "string" || parseVersion(minShellVersion) === null) return null;
  if (typeof manifestUrl !== "string" || !manifestUrl.startsWith(`${SITE_ORIGIN}/`)) return null;
  if (typeof archiveUrl !== "string" || !archiveUrl.startsWith(`${SITE_ORIGIN}/`)) return null;
  return { version, minShellVersion, manifestUrl, archiveUrl };
}
