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

/**
 * One "@" or "#" (etc.) picker's candidate pool. A field wires one of these
 * per sigil it wants to support; `useMention` below arbitrates which one (if
 * any) is live at the cursor.
 */
export interface MentionSource<T> {
  /** Single character, e.g. "@" or "#". */
  trigger: string;
  items: readonly MentionItem<T>[];
  /**
   * Builds the "create new" row shown when `query` is non-empty and matches
   * no existing item's label case-insensitively (exact match, not substring —
   * a partial match like "urg" against "Urgent" still offers to create "urg"
   * unless "urgent" itself already exists). Appended after `items` is
   * filtered and capped, so it is never the thing pushed out by real matches.
   */
  onNoMatch?: (query: string) => MentionItem<T> | null;
}

interface UseMentionOptions<T> {
  value: string;
  cursor: number;
  sources: readonly MentionSource<T>[];
}

interface UseMentionResult<T> {
  trigger: MentionTrigger | null;
  /** Which source's sigil is live, e.g. "@" or "#" — null when `trigger` is.
   * Lets a caller with more than one source label the popover accordingly. */
  sigil: string | null;
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
 * Drives an inline-mention popover for any text field: pass the field's
 * current value, cursor position, and one `MentionSource` per sigil it
 * supports, get back whether a picker should be open, its filtered results,
 * and the keyboard/selection plumbing for it.
 *
 * A single hook instance handles every sigil rather than one `useMention`
 * call per sigil — two calls would mean two `isOpen` states and two popovers
 * to arbitrate. Only one sigil can ever be live at the cursor at once (a live
 * run has no whitespace in it, and the other sigil needs whitespace before it
 * to trigger at all — see `mention.ts`), so arbitration only matters as a
 * defensive tiebreak: the source whose trigger starts nearest the cursor wins.
 *
 * Read docs/AT-MENTION.md before wiring this into a new field — it covers the
 * cursor-tracking contract this hook expects from its caller, and the
 * positioning tradeoff `MentionMenu` below makes.
 */
export function useMention<T>({ value, cursor, sources }: UseMentionOptions<T>): UseMentionResult<T> {
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const active = useMemo(() => {
    let best: { source: MentionSource<T>; trigger: MentionTrigger } | null = null;
    for (const source of sources) {
      const trigger = findMentionTrigger(value, cursor, source.trigger);
      if (trigger && (!best || trigger.start > best.trigger.start)) {
        best = { source, trigger };
      }
    }
    return best;
  }, [value, cursor, sources]);

  const trigger = active?.trigger ?? null;

  const results = useMemo(() => {
    if (!active) return [];
    const { source, trigger } = active;
    const filtered = filterMentionItems(source.items, trigger.query);
    const query = trigger.query.trim().toLowerCase();
    if (!query || !source.onNoMatch) return filtered;
    const hasExactMatch = source.items.some((item) => item.label.toLowerCase() === query);
    if (hasExactMatch) return filtered;
    const extra = source.onNoMatch(trigger.query);
    return extra ? [...filtered, extra] : filtered;
  }, [active]);

  // Keyed on the cursor position at the moment of dismissal, not a bare
  // boolean: any further keystroke moves the cursor (typing extends it,
  // deleting retracts it, arrow keys move it), which is exactly the signal
  // that should reopen the popover. A boolean flag would stay dismissed for
  // the rest of the same "@word" no matter how much more you typed into it.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

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
  const currentKey = active ? `${active.source.trigger}:${active.trigger.start}:${active.trigger.query}` : null;
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
    sigil: active?.source.trigger ?? null,
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
