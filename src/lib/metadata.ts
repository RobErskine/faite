import type { Metadata } from "next";
import { SITE_NAME, sitePage } from "@/lib/site";

/**
 * The per-page `Metadata` export. Every static page is exactly:
 *
 *   export const metadata = pageMetadata("/privacy");
 *
 * The full `openGraph` object below is NOT redundant with the root layout's.
 * Next resolves metadata by iterating the keys a segment actually declares
 * (`resolve-metadata.js`'s `mergeMetadata`) and REPLACES `openGraph`
 * wholesale rather than deep-merging it — a page that set only
 * `openGraph.url` would ship without `og:site_name`/`og:type`/`og:locale`.
 * Emitting the whole object here is what keeps that from being a per-page
 * footgun.
 *
 * Deliberately no `twitter` key. `postProcessMetadata` back-fills twitter's
 * title/description/images from `openGraph` when a page declares none, and
 * the card type is pinned once in the root layout. A `twitter` block here
 * would have to be kept in lockstep with `openGraph` for zero gain.
 *
 * Keys are OMITTED rather than set to `undefined`: the merge loop is a
 * `for…in`, so a present-but-undefined key still overwrites the parent's
 * value. That's why "/" (title: null in SITE_PAGES) gets no `title` key at
 * all here instead of `title: undefined` — the latter would blank the root
 * layout's `title.default`.
 */
export function pageMetadata(path: string): Metadata {
  const { title, description } = sitePage(path);

  return {
    ...(title === null ? {} : { title }),
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: path,
      title: title ?? SITE_NAME,
      description,
    },
  };
}
