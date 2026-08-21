import { AlertTriangleIcon } from "lucide-react";
import { ProseLink } from "@/components/marketing/prose";

/**
 * Opens every legal page (`/privacy`, `/terms`) until a human lawyer has
 * reviewed the copy. Deliberately one component in one file: removing it
 * later is a single deletion plus import removals, not a hunt through every
 * legal page for a repeated disclaimer block.
 *
 * Visually loud rather than prose-coloured on purpose — this notice needs to
 * read as a warning, not blend into the surrounding legal text it's
 * disclaiming.
 */
export function LegalPlaceholderNotice() {
  return (
    <div
      role="note"
      className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <AlertTriangleIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <p className="leading-6 text-foreground">
        <strong className="font-semibold">Placeholder draft.</strong> This page was
        written from the Faite codebase to describe what the product actually does,
        but it has not been reviewed by a lawyer and is not a binding agreement.
        Questions? <ProseLink href="/contact">Get in touch</ProseLink>.
      </p>
    </div>
  );
}
