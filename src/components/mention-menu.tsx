"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  filterMentionItems,
  findMentionTrigger,
  resolveMentionTrigger,
  type MentionTrigger,
  type ResolvedMention,
} from "@/lib/mention";

export interface MentionItem<T> {
  id: string;
  label: string;
  data: T;
}

interface UseMentionOptions<T> {
  value: string;
  cursor: number;
  items: readonly MentionItem<T>[];
}

interface UseMentionResult<T> {
  trigger: MentionTrigger | null;
  results: MentionItem<T>[];
  /** False once the caller has dismissed an otherwise-live trigger — see `dismiss`. */
  isOpen: boolean;
  highlightedIndex: number;
  setHighlightedIndex: (index: number) => void;
  moveHighlight: (delta: number) => void;
  /** Resolves a specific item — for a mouse click on a row. */
  resolve: (item: MentionItem<T>) => ResolvedMention & { item: MentionItem<T> };
  /** Resolves whichever item is highlighted — for Enter. Null if nothing is open. */
  resolveHighlighted: () => (ResolvedMention & { item: MentionItem<T> }) | null;
  /** Closes the popover without touching the field's text — for Escape. */
  dismiss: () => void;
}

/**
 * Drives an "@mention" popover for any text field: pass the field's current
 * value and cursor position, get back whether a picker should be open, its
 * filtered results, and the keyboard/selection plumbing for it.
 *
 * Read docs/AT-MENTION.md before wiring this into a new field — it covers the
 * cursor-tracking contract this hook expects from its caller, and the
 * positioning tradeoff `MentionMenu` below makes.
 */
export function useMention<T>({ value, cursor, items }: UseMentionOptions<T>): UseMentionResult<T> {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  // Keyed on the cursor position at the moment of dismissal, not a bare
  // boolean: any further keystroke moves the cursor (typing extends it,
  // deleting retracts it, arrow keys move it), which is exactly the signal
  // that should reopen the popover. A boolean flag would stay dismissed for
  // the rest of the same "@word" no matter how much more you typed into it.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const trigger = useMemo(() => findMentionTrigger(value, cursor), [value, cursor]);
  const results = useMemo(
    () => (trigger ? filterMentionItems(items, trigger.query) : []),
    [trigger, items],
  );

  /**
   * Resets the highlight back to the top match whenever the query changes —
   * a fresh trigger, or another character typed into the same one — since
   * the filtered list's contents change entirely and the old index no longer
   * means anything.
   *
   * Done as a conditional `setState` during render (React's documented
   * "adjusting state when a prop changes" pattern), not inside a `useEffect`:
   * comparing against a value stored from the previous render and correcting
   * before commit avoids the extra render + paint an effect-based reset
   * would add, and is exactly what the pattern exists for.
   */
  const [resetKey, setResetKey] = useState<string | null>(null);
  const currentKey = trigger ? `${trigger.start}:${trigger.query}` : null;
  if (currentKey !== resetKey) {
    setResetKey(currentKey);
    if (highlightedIndex !== 0) setHighlightedIndex(0);
  }

  const isOpen = trigger !== null && results.length > 0 && cursor !== dismissedAt;
  const clampedIndex = results.length === 0 ? 0 : Math.min(highlightedIndex, results.length - 1);

  const moveHighlight = (delta: number) => {
    if (results.length === 0) return;
    setHighlightedIndex((clampedIndex + delta + results.length) % results.length);
  };

  const resolve = (item: MentionItem<T>) => {
    if (!trigger) return { text: value, caretIndex: cursor, item };
    return { ...resolveMentionTrigger(value, trigger, ""), item };
  };

  const resolveHighlighted = () => {
    const item = results[clampedIndex];
    return item ? resolve(item) : null;
  };

  const dismiss = () => setDismissedAt(cursor);

  return {
    trigger,
    results,
    isOpen,
    highlightedIndex: clampedIndex,
    setHighlightedIndex,
    moveHighlight,
    resolve,
    resolveHighlighted,
    dismiss,
  };
}

interface MentionMenuProps<T> {
  results: readonly MentionItem<T>[];
  highlightedIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (item: MentionItem<T>) => void;
  /**
   * Which edge of the anchor to open from. Pick "up" for a field pinned near
   * the bottom of a scrolling container (quick-add's case, since it always
   * sits last in the list) so the popover doesn't get clipped by the
   * container's own `overflow`.
   */
  side?: "up" | "down";
  /** Distinguishes this listbox from any other on the page (e.g. a `cmdk`
   * results list also has `role="listbox"`) for screen readers and tests. */
  ariaLabel?: string;
}

/**
 * The picker itself — a plain anchored popover (`position: absolute` against
 * the nearest `relative` ancestor), not portaled. That is enough for a field
 * pinned near one edge of its scroll container; a field that can sit
 * anywhere on screen (a long note, a description textarea scrolled mid-way)
 * would need real viewport-aware positioning instead — see docs/AT-MENTION.md.
 */
export function MentionMenu<T>({
  results,
  highlightedIndex,
  onHighlight,
  onSelect,
  side = "down",
  ariaLabel = "Suggestions",
}: MentionMenuProps<T>) {
  if (results.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label={ariaLabel}
      className={cn(
        "absolute z-20 max-h-48 w-56 overflow-auto rounded-lg border border-foreground/10 bg-popover p-1 text-sm text-popover-foreground shadow-md",
        side === "up" ? "bottom-full left-0 mb-1" : "top-full left-0 mt-1",
      )}
    >
      {results.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={index === highlightedIndex}
          onMouseEnter={() => onHighlight(index)}
          // mousedown with preventDefault, not onClick: the field's onBlur
          // fires on the focus change a click would cause, which would commit
          // (or otherwise finalize) the field before the click ever lands.
          // Preventing default on mousedown keeps focus in the field entirely.
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(item);
          }}
          className={cn(
            "flex w-full items-center rounded-md px-2 py-1.5 text-left outline-none select-none",
            index === highlightedIndex ? "bg-muted text-foreground" : "hover:bg-muted/60",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
