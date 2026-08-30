import type { DesktopVersionPolicy } from "@/lib/desktop/version";
import { SITE_ORIGIN } from "@/lib/site";

/**
 * What the server tells a desktop build about its own age (EI-147). Served
 * from `GET /api/desktop/version`, read by `src/lib/desktop/version.ts`.
 *
 * **This table is the entire update policy, and it is the only part that can
 * change without shipping a new desktop build.** Editing it is a web deploy.
 *
 * - `latest` — bump on every published desktop release, together with
 *   `src-tauri/tauri.conf.json`'s `version`. Running copies below it show a
 *   dismissible "an update is available" bar.
 * - `minimum` — a HARD block: below it the app tells the user it can no
 *   longer sync and offers nothing but the download. Raise it only for a
 *   change an old client genuinely cannot survive (a sync-protocol break, a
 *   security fix), never for "please update". Everyone below it is stranded
 *   until they install by hand — there is no auto-updater yet (EI-134/EI-136).
 * - `downloadUrl` — must stay on `SITE_ORIGIN`. Both the client
 *   (`parseVersionPolicy`) and Tauri's own capability allow-list
 *   (`src-tauri/capabilities/default.json`) refuse anything else, so moving
 *   downloads to another host means widening both, deliberately.
 *
 * Both versions start equal at today's shipped build: nothing is out of date
 * and nothing is blocked, which is the correct state for a check whose job
 * right now is only to EXIST in the field.
 */
export const DESKTOP_VERSION_POLICY: DesktopVersionPolicy = {
  latest: "0.1.0",
  minimum: "0.1.0",
  downloadUrl: `${SITE_ORIGIN}/download`,
};
