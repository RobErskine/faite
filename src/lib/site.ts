/**
 * The canonical origin. No `next/*` import here on purpose — this table is
 * read by vitest, Playwright, and the Worker (`src/server/worker.ts`) as well
 * as the Next app, and only the app program has `next` in its module graph.
 *
 * Pinned to the custom domain (`wrangler.jsonc` `routes[0].pattern`) even on
 * `*.workers.dev` preview URLs — a preview that self-canonicalised would
 * compete with production for the same search queries.
 *
 * No trailing slash: this becomes `metadataBase` (`new URL(SITE_ORIGIN)`),
 * and a trailing slash there makes every relative canonical resolve one path
 * segment short of where it should land.
 */
export const SITE_ORIGIN = "https://myfaite.app";

export const SITE_NAME = "Faite";

export const SITE_DESCRIPTION = "Control your fate by getting things done.";

export type FooterGroupId = "product" | "support" | "legal";

export const FOOTER_GROUPS: readonly { id: FooterGroupId; label: string }[] = [
  { id: "product", label: "Product" },
  { id: "support", label: "Support" },
  { id: "legal", label: "Legal" },
];

export interface SitePage {
  /** Route path, exactly as the directory appears under `src/app`. */
  path: string;
  /**
   * The page's `<h1>` and the `%s` of the root title template.
   * `null` on "/" only — the marketing page keeps the root layout's bare
   * "Faite" rather than becoming "Faite · Faite".
   */
  title: string | null;
  /** `<meta name="description">`, and the lede under the `<h1>` on shell pages. */
  description: string;
  /**
   * Hand-maintained ISO date (YYYY-MM-DD) of the last CONTENT change.
   * Deliberately not `new Date()`: a build-time date would churn
   * `sitemap.xml`'s `<lastmod>` on every deploy and lie to crawlers about
   * content having changed. File mtime is no better — a CI checkout stamps
   * every file with clone time, not edit time. This same value renders as the
   * "Last updated" line on legal pages, so the two can't drift apart.
   */
  updated: string;
  /** Footer column, or `null` to keep the page out of the footer entirely. */
  footerGroup: FooterGroupId | null;
  /** Shorter footer label; falls back to `title` when omitted. */
  footerLabel?: string;
  /** Render the "Last updated" line. Legal pages only. */
  showUpdated?: boolean;
}

export const SITE_PAGES: readonly SitePage[] = [
  {
    path: "/",
    title: null,
    description: SITE_DESCRIPTION,
    updated: "2026-08-20",
    footerGroup: null,
  },
  {
    path: "/terms",
    title: "Terms of Service",
    description: "The agreement between you and Faite.",
    updated: "2026-08-20",
    footerGroup: "legal",
    footerLabel: "Terms",
    showUpdated: true,
  },
  {
    path: "/privacy",
    title: "Privacy Policy",
    description: "What Faite collects, what it doesn't, and who can see it.",
    updated: "2026-08-20",
    footerGroup: "legal",
    footerLabel: "Privacy",
    showUpdated: true,
  },
  {
    path: "/help",
    title: "Help",
    description: "How to use the board: lists, days, Overdrive, reminders.",
    updated: "2026-08-20",
    footerGroup: "product",
  },
  {
    path: "/support",
    title: "Support",
    description: "Something broken? Start here.",
    updated: "2026-08-20",
    footerGroup: "support",
  },
  {
    path: "/about",
    title: "About",
    description: "Who makes Faite, and why it works the way it does.",
    updated: "2026-08-20",
    footerGroup: "product",
  },
];

/**
 * Routes deliberately kept out of the sitemap and disallowed in robots.txt.
 *
 * `/board` renders nothing useful to a crawler (client-only, hydrated from
 * IndexedDB — see `docs/ARCHITECTURE.md` §2.13); indexing it would publish
 * "Loading your board…". The auth routes are worse than useless to a
 * crawler: `/reset-password` and `/verify-email` are only meaningful with a
 * one-time token in the query string, and a crawler following one burns it.
 *
 * `site.test.ts` asserts SITE_PAGES + PRIVATE_ROUTES together account for
 * every route under `src/app`, so a new page can't be added without a
 * conscious decision about which list it belongs in.
 */
export const PRIVATE_ROUTES: readonly string[] = [
  "/board",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];

/** Throws on an unknown path — a missing table row is a build failure, not a silent gap. */
export function sitePage(path: string): SitePage {
  const page = SITE_PAGES.find((p) => p.path === path);
  if (!page) throw new Error(`[site] No SITE_PAGES entry for "${path}". Add one.`);
  return page;
}
