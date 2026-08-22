import { ApiReference } from "@/components/docs/api-reference";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata("/docs");

/**
 * Public API reference (A7, EI-231), rendered from `openapi/v1.json` by
 * Scalar's React component. No `PageShell` here — that component's
 * `max-w-2xl` reading-measure container is for prose pages; Scalar renders
 * its own full-viewport layout (nav sidebar, try-it panel) that a narrow
 * wrapper would clip.
 *
 * No page-level `<h1>` of our own, deliberately: Scalar renders one itself
 * from the spec's `info.title` ("Faite API"). A second `<h1>` here would be
 * a real duplicate-heading a11y bug, not just a test artifact — so
 * `SITE_PAGES`'s `/docs` title is set to match Scalar's exactly, letting it
 * serve as this page's one real `<h1>` (`e2e/marketing-pages.spec.ts` checks
 * every `SITE_PAGES` entry has exactly one, matching its title verbatim).
 * `MarketingFooter` is kept, same as every other page.
 */
export default function DocsPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingHeader />
      <ApiReference />
      <MarketingFooter />
    </div>
  );
}
