import type { MetadataRoute } from "next";
import { PRIVATE_ROUTES, SITE_ORIGIN } from "@/lib/site";

// See sitemap.ts / manifest.ts — required under `output: "export"`.
export const dynamic = "force-static";

/**
 * `/api/` is disallowed alongside the app routes even though no `/api/*`
 * path is a Next route at all — they're intercepted in `src/server/worker.ts`
 * before OpenNext ever sees them (`docs/ARCHITECTURE.md` §2.12). A crawler
 * doesn't know that, and `/api/auth/*` will happily answer a GET.
 *
 * This file is also served on the `*.workers.dev` preview URLs
 * (`wrangler.jsonc` has `workers_dev: true`), which invites indexing a
 * duplicate of production. There's no clean per-origin mitigation for that
 * (Cloudflare's static-asset headers can't match on hostname); the
 * `metadataBase`-driven absolute canonical on every page is what actually
 * points search engines at `myfaite.app` regardless of which origin served
 * the crawl.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...PRIVATE_ROUTES, "/api/"],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
