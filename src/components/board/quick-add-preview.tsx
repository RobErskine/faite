import type { MouseEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { edge, tint } from "@/lib/colors";
import {
  unresolvedMentionLabel,
  type QuickAddMatch,
  type ResolvedQuickAdd,
} from "@/lib/quick-add";

export interface QuickAddChip {
  key: string;
  label: string;
  /**
   * The list's own accent — set only on the "→ list" chip, so it reads at a
   * glance as the same list the column headers and cards already color, per
   * the label-chip convention in `todo-card.tsx`. Every other chip (P2, a
   * date, a time) stays neutral; they don't have a color to borrow.
   */
  color?: string | null;
  /**
   * Something typed that did NOT apply — an "@mention" that matched no list,
   * "yesterday" (EI-375). Drawn dashed and achromatic: an outline of a chip
   * that isn't there, not a warning. Red stays reserved for urgency
   * (docs/DESIGN.md), and nothing here is urgent — the text is all kept.
   */
  dashed?: boolean;
  /** Longer words for the chip, as a tooltip — "No list is called @to-read". */
  hint?: string;
  /**
   * Dismisses the chip. On a "#label" chip it un-picks the label; on a
   * parsed date/time/priority chip it puts the word back in the title,
   * unparsed (EI-375 — "Call the dentist about Thursday" keeps Thursday).
   */
  onRemove?: () => void;
  /** The remove button's accessible name — defaults to "Remove <label>". */
  removeLabel?: string;
  /** One follow-up a dashed chip can offer, e.g. "Create list". */
  action?: { label: string; ariaLabel?: string; onAction: () => void };
}

/**
 * Wires a chip control for both pointers and keys without committing the
 * field it belongs to.
 *
 * Mouse: `mousedown` + `preventDefault`, not `click` — the field never loses
 * focus, so a column's commit-on-blur can't create the to-do before the
 * removal lands. Same reason MentionMenu's rows do this.
 *
 * Keyboard: the chip is reachable with Tab (a column's quick-add commits
 * only when focus leaves the whole row, chips included), and Enter/Space
 * fire `click` with `detail === 0`. Focus goes back to the field FIRST, so
 * the button unmounting under it never strands focus on `<body>`.
 */
function chipHandlers(run: () => void, focusField?: () => void) {
  return {
    onMouseDown: (e: MouseEvent) => {
      e.preventDefault();
      run();
    },
    onClick: (e: MouseEvent) => {
      if (e.detail !== 0) return; // a pointer click — `mousedown` already ran
      focusField?.();
      run();
    },
  };
}

/**
 * The live feedback that teaches the quick-add syntax: a token is applied the
 * moment it's recognized, and nothing shows when it isn't. Shared by the
 * column quick-add row and the command palette so both teach one grammar.
 *
 * Takes plain chips rather than `QuickAddMatch[]` directly — the "@list"
 * mention (`mention-menu.tsx`) is not a `parseQuickAdd` token (it's a UI pick,
 * not text grammar), so callers build one combined chip list from both
 * sources rather than this component knowing about either.
 */
export function QuickAddPreview({
  chips,
  className,
  focusField,
}: {
  chips: QuickAddChip[];
  /** Overrides the default padding, tuned for the column quick-add row's own
   * inset — the todo sheet's title field has none, so it needs a flush one. */
  className?: string;
  /** Returns focus to the text field after a chip is used from the keyboard. */
  focusField?: () => void;
}) {
  if (chips.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1 px-2 pb-1.5", className)}>
      {chips.map((chip) => {
        const style = chip.color
          ? { backgroundColor: tint(chip.color), borderColor: edge(chip.color), color: chip.color }
          : undefined;
        const classes = cn(
          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-2xs font-medium leading-none",
          chip.dashed
            ? "border-dashed border-muted-foreground/50 bg-transparent text-muted-foreground"
            : !chip.color && "border-border/60 bg-muted/60 text-muted-foreground",
        );
        const focusRing =
          "rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60";
        return (
          <span key={chip.key} className={classes} style={style} title={chip.hint}>
            {chip.label}
            {chip.action && (
              <button
                type="button"
                aria-label={chip.action.ariaLabel ?? chip.action.label}
                className={cn(focusRing, "underline underline-offset-2 hover:text-foreground")}
                {...chipHandlers(chip.action.onAction, focusField)}
              >
                {chip.action.label}
              </button>
            )}
            {chip.onRemove && (
              <button
                type="button"
                aria-label={chip.removeLabel ?? `Remove ${chip.label}`}
                className={cn(
                  focusRing,
                  // A 10px glyph with a 16px target — `-m-0.5` keeps the chip's
                  // own size where it was.
                  "-m-0.5 inline-flex size-4 items-center justify-center opacity-70 hover:opacity-100",
                )}
                {...chipHandlers(chip.onRemove, focusField)}
              >
                <X className="size-2.5" aria-hidden />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

/**
 * A parsed date/time/priority chip that can be dismissed (EI-375). The owner
 * call: a date word inside a sentence ("Call the dentist about Thursday")
 * still parses, so the chip is the only place a misread shows — and the ×
 * is the way back. `dismiss` puts the word back in the title, unparsed.
 */
export function dismissibleMatchChip(
  match: QuickAddMatch,
  dismiss: (match: QuickAddMatch) => void,
  keyPrefix = "",
): QuickAddChip {
  return {
    key: `${keyPrefix}${match.kind}:${match.raw}`,
    label: match.label,
    onRemove: () => dismiss(match),
    removeLabel: `Keep “${match.raw}” in the title`,
  };
}

/**
 * The chips both quick-add fields add on top of the parsed tokens, from one
 * `resolveQuickAdd` result (EI-375): the list a typed "@mention" resolved to,
 * every "@mention" that resolved nowhere, and words like "yesterday" that
 * were kept as text on purpose.
 *
 * `typingMention` is the "@query" still being typed — it would read "no
 * list" on every keystroke until it matched, so it is left to the mention
 * menu until the caret leaves it. `pickedList` suppresses the resolved-list
 * chip when the menu already picked one: a pick outranks typed text.
 */
export function quickAddStatusChips<L extends { id: string; name: string; color?: string | null }>(
  resolved: ResolvedQuickAdd<L>,
  {
    typingMention = null,
    pickedList = false,
    onCreateList,
  }: {
    typingMention?: string | null;
    pickedList?: boolean;
    onCreateList?: (name: string) => void;
  } = {},
): QuickAddChip[] {
  const chips: QuickAddChip[] = [];
  if (resolved.list && !pickedList) {
    chips.push({
      key: `list:${resolved.list.id}`,
      label: `→ ${resolved.list.name}`,
      color: resolved.list.color ?? null,
    });
  }
  for (const mention of resolved.unresolvedMentions) {
    if (mention.raw === typingMention) continue;
    const none = mention.matches === 0;
    chips.push({
      key: `unresolved:${mention.raw}`,
      label: unresolvedMentionLabel(mention),
      dashed: true,
      hint: none
        ? `No list is called ${mention.raw}. It stays in the title.`
        : `${mention.raw} matches ${mention.matches} lists. It stays in the title.`,
      action:
        none && onCreateList
          ? {
              label: "Create list",
              ariaLabel: `Create a list called “${mention.query}”`,
              onAction: () => onCreateList(mention.query),
            }
          : undefined,
    });
  }
  for (const notice of resolved.notices) {
    chips.push({
      key: `notice:${notice.raw}`,
      label: notice.label,
      dashed: true,
      hint: "A past day can’t be scheduled. It stays in the title.",
    });
  }
  return chips;
}
