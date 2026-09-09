"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Archive, ArrowUp, Info, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { tabDragId, tabDropId, type TabCount } from "@/lib/board";
import { edge, tint } from "@/lib/colors";
import type { Tab } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/lib/reduced-motion";
import { useViewport } from "@/lib/use-viewport";
import { DragGrip } from "./drag-grip";

/** Where the traveling hover highlight sits, in the strip's own scrolled
 *  coordinate space (see the note where it is rendered). */
interface PillRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TabStripProps {
  tabs: Tab[];
  activeTabId: string;
  archivedCount: number;
  /**
   * Lists and open to-dos per tab (EI-118), keyed by tab id. Backlog and
   * finished work are excluded — see `tabCountsFrom` in `lib/board.ts`.
   * A tab absent from the map has no lists of its own.
   */
  counts: ReadonlyMap<string, TabCount>;
  /** The tab whose settings dialog is open, if any. */
  infoTabId: string | null;
  /** Edge to draw the insertion bar on while a tab drag hovers. */
  drop: { tabId: string; side: "before" | "after" } | null;
  /** True while a card is in flight — pills become hover-to-focus targets. */
  isCardDragActive: boolean;
  /**
   * True while a list column is in flight (EI-115) — same hover-to-focus
   * treatment as a card, so a list can be carried to another tab and dropped
   * among its columns, or directly on the pill to land at the end.
   */
  isListDragActive: boolean;
  onSelect: (tabId: string) => void;
  onOpenInfo: (tabId: string) => void;
  /** Right-click menu for a pill (EI-288). Omit for none. */
  renderMenu?: (tab: Tab) => React.ReactNode;
  onCreate: (name: string) => void;
  onOpenArchive: () => void;
}

/**
 * The planning half's tab bar.
 *
 * Replaces what used to be a static "My Lists" label. Tabs partition the list
 * columns below; the calendar half above and Backlog inside are shared by all
 * of them, so switching is a change of view rather than a change of scope.
 *
 * Doubles as a drop surface mid-drag: hovering a pill while carrying a card
 * focuses that tab (the dwell timer lives in Board, since only it knows the
 * drag state), which is what makes moving a to-do to another tab one gesture
 * instead of a drop, a click, and a second drag.
 */
export function TabStrip({
  tabs,
  activeTabId,
  archivedCount,
  counts,
  infoTabId,
  drop,
  isCardDragActive,
  isListDragActive,
  onSelect,
  onOpenInfo,
  renderMenu,
  onCreate,
  onOpenArchive,
}: TabStripProps) {
  /** `null` is idle. A string — including "" — means the field is open. */
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const name = draft?.trim();
    setDraft(null);
    if (name) onCreate(name);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether there's more strip to reach in each direction — drives the edge
  // fades below. Starts `false` so a strip that never overflows never shows
  // one; the effect below corrects it the moment there's something to know.
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  /*
    The traveling hover highlight. `rect` is kept after the pointer leaves so
    the highlight fades out where it stands instead of sliding back to the
    strip's origin; `lit` is what actually shows it.

    Only meaningful where a pointer can hover. On a touch device `pointerover`
    still fires on tap, which would light a pill and leave it lit, so the
    capability gates the handlers rather than just the styling.
  */
  const { hover: canHover } = useViewport();
  const [rect, setRect] = useState<PillRect | null>(null);
  const [lit, setLit] = useState(false);
  // A card or list being dragged onto the strip puts drop indicators on the
  // pills. A hover highlight on top of that is noise about a different thing.
  const dragActive = isCardDragActive || isListDragActive;

  const trackPointer = useCallback(
    (target: EventTarget | null) => {
      if (!canHover || dragActive) return;
      const pill =
        target instanceof Element ? target.closest<HTMLElement>("[data-tab-pill]") : null;
      if (!pill) {
        setLit(false);
        return;
      }
      /*
        `offsetLeft`/`offsetTop` are measured against the offset parent, which
        is the scroll container itself (it is `relative`). That is the same
        space the highlight is positioned in, so the pair stay in agreement
        while the strip is scrolled horizontally — no scroll listener, and no
        stale rect. Reading `getBoundingClientRect` here would need one.
      */
      setRect({ x: pill.offsetLeft, y: pill.offsetTop, w: pill.offsetWidth, h: pill.offsetHeight });
      setLit(true);
    },
    [canHover, dragActive],
  );

  const updateFades = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  /**
   * Fades the track's own content in and out at its scrollable edges, via a
   * mask on the scroll container rather than a gradient-filled overlay div.
   * An overlay has to guess the surrounding background color to blend in —
   * got wrong here once already (`from-background` over the planning half's
   * actual `bg-muted/30`, which read as a stray solid box) — and would need
   * a different guess in every context this component renders in (desktop,
   * phone). A mask fades the alpha of the content itself, so it's correct
   * against any backdrop with no color to maintain at all.
   */
  const trackMask = `linear-gradient(to right, ${
    canScrollLeft ? "transparent, black 24px" : "black"
  }, ${canScrollRight ? "black calc(100% - 24px), transparent" : "black"})`;

  // Re-checks on anything that can change the strip's content width —
  // creating/removing a tab or renaming one long enough to overflow — not
  // just on scroll.
  useEffect(() => {
    updateFades();
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateFades);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateFades, tabs.length]);

  // Keeps the active tab reachable without a manual scroll — selecting one
  // via `⌘K` or the keyboard would otherwise land off-screen exactly when a
  // scrolled strip makes that most likely.
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-tab-pill="${CSS.escape(activeTabId)}"]`,
    );
    el?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [activeTabId]);

  return (
    <div className="flex shrink-0 items-center gap-1 px-3 py-1.5">
      {/*
        Scrolls on its own rather than pushing Archived off the bar. `min-w-0`
        is what lets it actually shrink inside the flex row.
      */}
      <div
        ref={scrollRef}
        onScroll={updateFades}
        onPointerOver={(e) => trackPointer(e.target)}
        onPointerLeave={() => setLit(false)}
        className="column-track relative flex min-w-0 flex-1 items-center gap-1"
        // `column-track` (globals.css) deliberately leaves `overflow-y`
        // computed to `auto` — right for a genuinely tall list column, wrong
        // here: a single-row strip only ever needs the horizontal scrollbar,
        // and a stray 1px of vertical overflow (a focus ring, a grip's
        // pseudo-element inset) is enough to make the browser park a
        // vertical scrollbar thumb over the strip — its rounded, semi-opaque
        // thumb is what read as "a weird empty button" in review. Forced
        // off with an inline style so it wins regardless of class order.
        style={{ maskImage: trackMask, WebkitMaskImage: trackMask, overflowY: "hidden" }}
      >
        {/*
          One highlight for the whole strip, rendered before the pills so the
          pills paint over it — both are positioned, so DOM order decides.
          Under the active pill it is simply not visible: that pill has an
          opaque background, which is the right answer for "the tab you are
          on" anyway.

          It is not a hover *state* — it is one box that moves to wherever the
          pointer is. That is what a per-pill `hover:bg-*` cannot do, and why
          the pill no longer carries one.
        */}
        {rect && (
          <div
            aria-hidden
            data-tab-hover-highlight
            className={cn(
              // `bg-foreground/5`, the same wash the rows and group headers
              // use — not `bg-surface-2`, which the pill's *active* state uses.
              // In light theme `--surface-2` and `--background` are both pure
              // white: the active pill reads as raised because of its
              // `shadow-card`, not its fill, so a `bg-surface-2/60` hover was
              // white on white and showed nothing at all. Measured, not
              // guessed. One tint for "the pointer is here" across the board.
              "pointer-events-none absolute left-0 top-0 rounded-lg bg-foreground/5",
              "tab-travel motion-reduce:transition-none",
            )}
            style={{
              translate: `${rect.x}px ${rect.y}px`,
              width: rect.w,
              height: rect.h,
              opacity: lit ? 1 : 0,
            }}
          />
        )}

        {tabs.map((tab) => (
          <TabPill
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            isInfoOpen={infoTabId === tab.id}
            isCardDragActive={isCardDragActive}
            isListDragActive={isListDragActive}
            dropSide={drop?.tabId === tab.id ? drop.side : null}
            count={counts.get(tab.id) ?? { lists: 0, items: 0, assigned: 0 }}
            onSelect={() => onSelect(tab.id)}
            onOpenInfo={() => onOpenInfo(tab.id)}
            menu={renderMenu?.(tab)}
          />
        ))}

        {draft === null ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setDraft("")}
            aria-label="New tab"
            className="shrink-0 text-muted-foreground"
          >
            <Plus aria-hidden />
          </Button>
        ) : (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              // Escape abandons outright; blur is the forgiving path. Same
              // bargain as the quick-add and create-list fields.
              if (e.key === "Escape") setDraft(null);
            }}
            onBlur={commit}
            placeholder="Tab name"
            aria-label="New tab name"
            className={cn(
              "w-28 shrink-0 rounded-md border border-dashed border-foreground/30 bg-background/60",
              "px-2 py-1 text-xs outline-none placeholder:text-muted-foreground/60",
            )}
          />
        )}
      </div>

      {/*
        Pushed to the far edge: the archive is the counterpart to the tabs named
        on the left, not another item in that group.

        Icon-only — the word "Archived" cost more strip width than it earned
        once a board can carry a dozen tabs. The count sits inline in
        parens rather than a corner badge — a badge reads as "this needs
        your attention", which an empty-able archive count is not — and only
        once there is something to count; an empty archive doesn't need a 0.
        `aria-label` fully owns the accessible name so the aria-hidden count
        can't garble it into "Archived 3".

        The tooltip earns its keep twice over: at count 0 the button is a
        bare icon, so hover is how a sighted user learns its name — and
        `completion-tooltip.spec.ts`'s CONTROL test hovers exactly this
        button to prove the tooltip harness works at all. Do not remove it.
      */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1 text-muted-foreground"
              onClick={onOpenArchive}
              aria-label="Archived"
            >
              <Archive aria-hidden />
              {archivedCount > 0 && (
                <span aria-hidden className="num">
                  ({archivedCount})
                </span>
              )}
            </Button>
          }
        />
        <TooltipContent>
          {archivedCount > 0 ? `Archived (${archivedCount})` : "Archived"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

interface TabPillProps {
  tab: Tab;
  isActive: boolean;
  isInfoOpen: boolean;
  isCardDragActive: boolean;
  isListDragActive: boolean;
  dropSide: "before" | "after" | null;
  /** Lists and open to-dos on this tab, Backlog excluded — see `TabStripProps.counts`. */
  count: TabCount;
  onSelect: () => void;
  onOpenInfo: () => void;
  menu?: React.ReactNode;
}

function TabPill({
  tab,
  isActive,
  isInfoOpen,
  isCardDragActive,
  isListDragActive,
  dropSide,
  count,
  onSelect,
  onOpenInfo,
  menu,
}: TabPillProps) {
  const { setNodeRef, isOver } = useDroppable({ id: tabDropId(tab.id) });

  /**
   * Hovering a pill with a card OR a list column in hand is a *focus*
   * gesture — for a card, the item lands in a column afterwards; for a list
   * (EI-115), releasing right here is also valid (it lands at the end of
   * this tab), but the pointer doesn't yet know which the user will do.
   * Highlighting it as though it were an ordinary drop target would promise
   * something a card release here does not deliver, so the pending state is
   * a ring, distinct from a column's filled target styling.
   */
  const isFocusCandidate = (isCardDragActive || isListDragActive) && isOver && !isActive;

  /**
   * Spells out the bare `3/0/1` badge for the tooltip and for screen readers.
   * Declared above `pill` because that JSX is built at assignment, not on
   * render — referencing this below it would be a temporal-dead-zone throw.
   *
   * "assigned to a day" rather than "scheduled": the third number exists
   * precisely because those to-dos have LEFT their list column for the
   * calendar half, which is what makes a tab read `3/0/1` while its lists
   * all look empty.
   */
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const countLabel =
    `${plural(count.lists, "list", "lists")} with ` +
    `${plural(count.items, "item", "items")}` +
    (count.assigned > 0 ? `, plus ${plural(count.assigned, "item", "items")} assigned to a day` : "");

  /*
    The pill's own div becomes the context-menu trigger — same reasoning as a
    to-do row (docs/CONTEXT-MENU.md §5): the droppable ref and `data-tab-pill`
    stay on the element that already carried them.

    Unlike a card, this element is ALSO a Base UI `TooltipTrigger`, so two
    `useRender` components compose here — the exact shape of lessons L747,
    where the outer one silently swallowed the inner's handlers. Both halves
    are asserted in `e2e/context-menu.spec.ts` against a real hover, since
    neither happy-dom nor `locator.hover()` can open a Base UI tooltip.
  */
  const pill = (
    <ContextMenuTrigger
      ref={setNodeRef}
      data-tab-pill={tab.id}
      className={cn(
        "group/tab relative flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5",
        // Fast in, slower out — see the note on the row wash in todo-card.tsx.
        "transition-colors duration-(--dur-base) hover:duration-(--dur-fast)",
        // `items-center` centers the (small) grip/label/info row within the
        // taller box on a coarse pointer, rather than stretching them —
        // invisible padding around a small tap target, the same trick native
        // mobile UIs use.
        "pointer-coarse:min-h-11",
        // The raised tier (docs/DESIGN.md §3): a pill that sits above the
        // strip, with the shadow that says so in both themes.
        //
        // No `hover:bg-*` on an inactive pill: the strip's one traveling
        // highlight is the hover affordance now, and a per-pill wash on top
        // of it would double the tint on whichever pill the pointer is over.
        isActive && "bg-surface-2 shadow-card",
        // Roving-tabindex state, not a real `:focus-visible` — `ring-ring`
        // keeps it the same hue as every other focus cue on the board.
        isFocusCandidate && "ring-2 ring-ring ring-offset-1 ring-offset-muted",
      )}
      style={
        // The tab's own color wins over the neutral active treatment, so an
        // active colored tab reads as itself rather than as "the active one".
        isActive ? { backgroundColor: tint(tab.color) } : undefined
      }
    >
      {/*
        Insertion bar for tab reordering. Carries `data-drop-indicator` so the
        drag overlay flies here on release, exactly as columns and cards do.
      */}
      {dropSide && (
        <span
          aria-hidden
          data-drop-indicator
          className={cn(
            "absolute inset-y-0 z-10 w-0.5 rounded-full bg-primary",
            dropSide === "before" ? "-left-0.5" : "-right-0.5",
          )}
        />
      )}

      <TabGrip tab={tab} />

      <button
        type="button"
        onClick={onSelect}
        aria-current={isActive ? "true" : undefined}
        className={cn(
          "focus-ring flex max-w-40 min-w-0 items-baseline gap-1 rounded text-xs",
          isActive ? "font-semibold" : "text-muted-foreground",
        )}
      >
        <span className="min-w-0 truncate">{tab.name}</span>
        {/*
          `lists/items/assigned`, bare — no parens. Three numbers plus
          brackets is more punctuation than name on a narrow pill, and the
          slashes already group them. Says nothing useful spelled out letter
          by letter, so `sr-only` below carries the real sentence — the same
          bargain as the deadline/location markers in todo-row-parts.tsx.
        */}
        <span aria-hidden className="num shrink-0 text-2xs font-normal text-muted-foreground/60">
          {count.lists}/{count.items}/
          {/*
            The third number is the one that confuses: a tab can read `3/0/1`
            while every list in it looks empty, because that item has moved UP
            to a day. The arrow says "above" without the tooltip.
          */}
          <ArrowUp className="inline size-2.5 align-[-0.05em]" aria-hidden />
          {count.assigned}
        </span>
        <span className="sr-only">, {countLabel}</span>
      </button>

      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onOpenInfo}
        aria-label={`Tab options for ${tab.name}`}
        className={cn(
          // Same bargain as ColumnInfoButton: quiet until hovered or focused,
          // and pinned open while its dialog is, so the control you just
          // clicked does not vanish under the thing it opened.
          //
          // The two states are branches rather than an override because
          // tailwind-merge cannot see that `hover-reveal` and `opacity-100`
          // both set opacity — it would keep both and let emit order decide
          // (.ai/lessons.md, tailwind-merge and per-axis forms). Mutually
          // exclusive, there is nothing to resolve.
          "size-4 text-muted-foreground/50 transition-opacity",
          isInfoOpen ? "opacity-100" : "hover-reveal group-hover/tab:opacity-100",
        )}
      >
        <Info aria-hidden />
      </Button>

      {/*
        The color underline, on every colored tab rather than just the active
        one. A color you can only see by selecting the tab cannot be used to
        find it, which is most of what a color on a tab is for — so the strip
        shows all of them at once and lets selection be said by the background
        and weight instead.
      */}
      {tab.color && (
        <span
          aria-hidden
          className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full"
          style={{ backgroundColor: edge(tab.color) }}
        />
      )}
    </ContextMenuTrigger>
  );


  return (
    <ContextMenu disabled={!menu}>
    <Tooltip>
      <TooltipTrigger render={pill} />
      <TooltipContent>
        {tab.description ? (
          // `TooltipContent`'s popup is `inline-flex` (row), so two direct
          // children sit side by side, not stacked — this wrapper is the
          // flex item, and stacks its own children as a column.
          <span className="flex flex-col text-center">
            <span>{tab.description}</span>
            <span>{countLabel}</span>
          </span>
        ) : (
          countLabel
        )}
      </TooltipContent>
    </Tooltip>
    {menu}
    </ContextMenu>
  );
}

/**
 * Reorder handle for a tab.
 *
 * The one place on the board where the grip really is the only way in. A column
 * header hands its pointer activator to the whole header, but a tab's body is
 * itself a button, so a pointerdown anywhere on it would race the drag gesture
 * against the click that switches tabs — and unlike a card's title, that click
 * changes what the entire board is showing.
 *
 * Which makes `touch:opacity-100` load-bearing here in a way it isn't on the
 * other three reveals in this file: `group-hover/tab` is gated to
 * `(hover: hover)` (Tailwind v4), so without the touch fallback, a tab is
 * simply unreorderable on any device that can't hover — not degraded, gone.
 */
function TabGrip({ tab }: { tab: Tab }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: tabDragId(tab.id),
  });

  return (
    <DragGrip
      ref={setNodeRef}
      aria-label={`Drag to reorder the ${tab.name} tab`}
      className={cn(
        // Branches, not an override: see the note on the info button above.
        // It also settles a conflict that was there before — the grip is
        // hovered while it is being dragged, so `group-hover:opacity-100` beat
        // the `opacity-40` that is supposed to dim the source of the drag.
        isDragging ? "opacity-40" : "hover-reveal group-hover/tab:opacity-100",
      )}
      {...attributes}
      {...listeners}
    />
  );
}
