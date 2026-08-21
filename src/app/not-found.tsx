import Link from "next/link";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Site chrome instead of the bare Next 404. Uses `MarketingHeader` +
 * `MarketingFooter` directly rather than `PageShell` — a 404 has no
 * `SITE_PAGES` row (and shouldn't get one; `sitePage()` throwing on an
 * unknown path is the whole point of that table), so `PageShell`'s lookup
 * would itself throw here.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingHeader />

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
        <div className="space-y-3">
          <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            Page not found
          </h1>
          <p className="text-base text-muted-foreground sm:text-lg">
            That page doesn&apos;t exist, or it moved.
          </p>
        </div>

        <Link href="/" className={cn(buttonVariants({ variant: "default" }))}>
          Back to Faite
        </Link>
      </main>

      <MarketingFooter />
    </div>
  );
}
