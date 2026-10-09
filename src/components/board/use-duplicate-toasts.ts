"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { isHeldDuplicate } from "@/lib/duplicates";
import type { Todo } from "@/lib/schema";

/** Same truncation as `use-board-actions.ts`'s toast labels. */
function short(title: string, max = 40): string {
  const trimmed = title.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Announces a newly flagged duplicate (EI-346) with a toast that opens the
 * Duplicates sheet.
 *
 * The flag arrives from the server a second or two after the create, so this
 * watches the flagged set rather than any create path. The first loaded set
 * is only remembered, never announced — otherwise every reload would repeat
 * old flags. Several at once (a fresh device's first pull) become one toast.
 */
export function useDuplicateToasts(
  duplicates: Todo[] | undefined,
  holdAll: boolean,
  onReview: () => void,
): void {
  const seen = useRef<Set<string> | null>(null);
  const reviewRef = useRef(onReview);

  useEffect(() => {
    reviewRef.current = onReview;
  }, [onReview]);

  useEffect(() => {
    if (!duplicates) return;
    if (seen.current === null) {
      seen.current = new Set(duplicates.map((t) => t.id));
      return;
    }
    const known = seen.current;
    const fresh = duplicates.filter((t) => !known.has(t.id));
    for (const t of fresh) known.add(t.id);
    if (fresh.length === 0) return;

    const [first] = fresh;
    toast(
      fresh.length === 1 ? `Possible duplicate: “${short(first.title)}”` : `${fresh.length} possible duplicates`,
      {
        description:
          fresh.length === 1 && isHeldDuplicate(first, holdAll)
            ? "Held off your board until you review it."
            : undefined,
        duration: 8000,
        action: { label: "Review", onClick: () => reviewRef.current() },
      },
    );
    // A `holdAll` change re-runs this with nothing fresh, so it never re-announces.
  }, [duplicates, holdAll]);
}
