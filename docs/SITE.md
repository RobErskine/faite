# The marketing/legal/support site (the S milestone)

**Rationale for the whole milestone lives in Linear** (project Faite,
milestone "S — Site: marketing, legal, and support," EI-198–EI-216). This
doc is the operations reference: what `SITE_PAGES` is, the metadata contract
built on top of it, the static-export constraints every page here has to
respect, and the one-paragraph recipe for adding a ninth page correctly.

---

## 1. `SITE_PAGES` — one table, five readers

`src/lib/site.ts` exports `SITE_PAGES: readonly SitePage[]`, plus
`SITE_ORIGIN`, `SITE_NAME`, `SITE_DESCRIPTION`, `FOOTER_GROUPS`, and
`PRIVATE_ROUTES`. Every page under `src/app/{privacy,terms,help,support,
about,contact}/page.tsx` (plus `/`) has exactly one row, keyed by `path`.

No `next/*` import anywhere in this file, on purpose — it has to be readable
from five different places with five different module graphs:

| Reader | What it does with the table |
|---|---|
| `src/app/sitemap.ts` | Emits one `<url>` per `SITE_PAGES` row, absolute against `SITE_ORIGIN` |
| `src/app/robots.ts` | Disallows every `PRIVATE_ROUTES` entry |
| `src/components/marketing/marketing-footer.tsx` | Renders `FOOTER_GROUPS` × `SITE_PAGES.footerGroup` |
| `src/components/marketing/page-shell.tsx` | Looks up `title`/`description`/`updated` for the `<h1>`, lede, and "Last updated" line |
| `src/lib/metadata.ts`'s `pageMetadata(path)` | Looks up `title`/`description` for `Metadata.title`/`description` |
| `src/lib/site.test.ts` | The parity test — see §4 |

`sitePage(path)` **throws** on an unknown path. A missing row is a build
failure (or a test failure — see §4), never a silent gap. This is why
`RelatedLinks` (`prose.tsx`) can only reference a page that already has a
row: it calls `sitePage()` too, so a page cross-linking one that doesn't
exist yet fails immediately rather than shipping a link to nothing.

**Consequence for build order:** two pages that `RelatedLinks` each other
(e.g. `/terms` ↔ `/privacy`) have to land in the same PR, or the first one
crashes at build time until the second exists. This happened twice building
this milestone (EI-204/EI-205, then EI-208/EI-209/EI-210) — plain
`ProseLink` references (no `sitePage()` lookup, just an `<a>`/`next/link`)
don't have this constraint and can point at a page that doesn't exist yet.

`updated` is a **hand-maintained ISO date, not `new Date()`**: a build-time
date would churn `sitemap.xml`'s `<lastmod>` on every deploy and lie to
crawlers about content having changed. The same value renders as the "Last
updated" line on legal pages, so the two can't drift apart.

---

## 2. The metadata contract

Every page is one line:

```tsx
export const metadata = pageMetadata("/privacy");
```

`pageMetadata()` (`src/lib/metadata.ts`) exists because of two verified Next
16 resolver behaviors (`node_modules/next/dist/lib/metadata/resolve-metadata.js`),
not assumed ones — read from the resolver source while building EI-198:

1. **`openGraph` is replaced wholesale, not deep-merged.** `mergeMetadata`
   iterates the keys a segment actually declares; a page that set only
   `openGraph.url` would ship without `og:site_name`/`og:type`/`og:locale`
   because the parent's `openGraph` object is gone the moment the child
   declares its own. `pageMetadata()` always emits the *complete* object for
   this reason — never a partial one, however tempting the shortcut looks.
2. **A present-but-`undefined` key still overwrites.** The merge loop is a
   `for…in`, so `{ title: undefined }` still resets `title` to nothing. This
   is why `/` (whose row has `title: null`) gets **no `title` key at all**
   from `pageMetadata()`, rather than `title: undefined` — the latter would
   blank the root layout's `title.default` and `/` would render with an
   empty `<title>`.

**`pageMetadata()` never sets `twitter`.** Next's `postProcessMetadata`
back-fills `twitter`'s title/description/images from `openGraph` when a
segment declares no `twitter` key of its own, and the card type
(`summary_large_image`) is pinned once in the root layout
(`src/app/layout.tsx`). A per-page `twitter` block would have to be kept in
lockstep with `openGraph` for zero gain — worse, setting `twitter.title` in
the *root* layout (rather than leaving it unset there too) would stick to
every page, since no page's `pageMetadata()` output touches that key at all.

**Root layout owns:** `metadataBase` (`new URL(SITE_ORIGIN)`), the title
template (`"%s · Faite"`, with `default: "Faite"` so `/board` and the auth
routes — which export no metadata of their own — keep resolving to exactly
`"Faite"`), and the fallback `openGraph`/`twitter`. Deliberately **no root
`alternates`**: a root `canonical: "/"` would tell crawlers `/board` and
every auth route are duplicates of the home page.

---

## 3. Static-export constraints

`next.config.ts` flips to `output: "export"` under `BUILD_TARGET=static`
(`npm run build:static`, the Capacitor/Tauri guard, enforced in CI by
`npm run verify`). See `docs/ARCHITECTURE.md` §2.12 for the full reasoning;
the summary that matters here:

- **No Next Route Handler that reads `Request`.** This is why the contact
  form's backend (`POST /api/contact`) lives in `src/server/contact/routes.ts`,
  wired into `src/server/worker.ts` alongside `/api/auth/*`, `/api/sync/*`,
  `/api/places/*`, `/api/email/*` — not as an `app/api/contact/route.ts`.
  `docs/ARCHITECTURE.md` §2.12's seam table now has five rows, not four.
- **No middleware, no redirects/rewrites/headers in `next.config.ts`.**
  Every static page here is a Server Component with zero data fetching.
  `/contact` is the one exception with real client JS — it's a Client
  Component doing a client-side `fetch`, which is fine under
  `output: "export"` since nothing about it is server-rendered.
- **`sitemap.ts`/`robots.ts` need `export const dynamic = "force-static"`**,
  the same requirement `manifest.ts` already documented — without it the
  static export build fails outright, since the route has no default
  rendering mode to fall back to without a server.

---

## 4. How to add a page

1. Add a row to `SITE_PAGES` in `src/lib/site.ts` — `path`, `title`,
   `description`, today's date as `updated`, and a `footerGroup` (or `null`
   to keep it out of the footer).
2. Add `src/app/<path>/page.tsx`:
   ```tsx
   import { PageShell } from "@/components/marketing/page-shell";
   import { Prose, ProseSection, ProseText } from "@/components/marketing/prose";
   import { pageMetadata } from "@/lib/metadata";

   export const metadata = pageMetadata("/your-path");

   export default function YourPage() {
     return (
       <PageShell path="/your-path">
         <Prose>
           <ProseSection id="first" heading="…">
             <ProseText>…</ProseText>
           </ProseSection>
         </Prose>
       </PageShell>
     );
   }
   ```
3. If the new page cross-links an existing one, use `RelatedLinks` (throws
   loudly if the target has no row) or `ProseLink` (a plain link, safe to
   point at a page that doesn't exist yet — see the build-order note in §1).
4. Run `npx vitest run src/lib/site.test.ts` — the parity test fails
   immediately if step 1 or step 2 is missing (a `SITE_PAGES` row with no
   matching `page.tsx` on disk, or vice versa). It's a unit test, not an
   e2e run, specifically so this is a few-hundred-millisecond failure during
   `npm test`, not a multi-minute one during `npm run e2e`.
5. Add a test case to `e2e/marketing-pages.spec.ts` — it's table-driven off
   `SITE_PAGES`, so a page with a row already gets the standard assertions
   (title, description, canonical, `og:site_name`, `<h1>`, footer) for
   free; add anything page-specific (e.g. `/privacy` and `/terms`'s
   placeholder-notice check) separately.
6. Legal pages (currently `/privacy`, `/terms`) open with
   `<LegalPlaceholderNotice />` (`src/components/marketing/legal-placeholder-notice.tsx`)
   until a human legal review lands — see the milestone's Linear description
   for the current status of that review.

A fresh read of this file, with no other context, should be enough to add a
ninth page correctly.
