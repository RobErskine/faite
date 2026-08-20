import type { MetadataRoute } from "next";
import { SITE_ORIGIN, SITE_PAGES } from "@/lib/site";

// Required under `output: "export"` (`npm run build:static`, the Capacitor
// guard) — same reason as `manifest.ts`: without it the static export build
// fails outright, since a route handler has no default rendering mode to
// fall back to without a server. The content here is already static (no
// request-time data), so this just makes explicit what was already true.
export const dynamic = "force-static";

/**
 * Absolute URLs, because a sitemap has no base to resolve relative paths
 * against — `metadataBase` (`src/app/layout.tsx`) doesn't apply to this route
 * convention.
 *
 * `lastModified` comes from each `SITE_PAGES` row's hand-maintained `updated`
 * field, NOT `new Date()` — see `site.ts` for why a build-time date is wrong
 * here (churns the sitemap on every deploy, lies to crawlers about content
 * having changed).
 *
 * Only `SITE_PAGES` appears here; `PRIVATE_ROUTES` is the deliberate
 * exclusion list. `site.test.ts` fails if a route in `src/app` is in neither.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return SITE_PAGES.map((page) => ({
    url: `${SITE_ORIGIN}${page.path}`,
    lastModified: page.updated,
    changeFrequency: page.path === "/" ? "monthly" : "yearly",
    priority: page.path === "/" ? 1 : 0.5,
  }));
}
