import { MarketingHeader } from "@/components/marketing/marketing-header";
import { ApiReference } from "@/components/docs/api-reference";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata("/docs");

/**
 * Public API reference (A7, EI-231), rendered from `openapi/v1.json` by
 * Scalar's React component. No `PageShell` here — that component's
 * `max-w-2xl` reading-measure container is for prose pages; Scalar renders
 * its own full-viewport layout (nav sidebar, try-it panel) that a narrow
 * wrapper would clip.
 */
export default function DocsPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingHeader />
      <ApiReference />
    </div>
  );
}
