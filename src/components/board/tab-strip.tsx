"use client";

import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Archive, Info, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { tabDragId, tabDropId } from "@/lib/board";
import { edge, tint } from "@/lib/colors";
import type { Tab } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { DragGrip } from "./drag-grip";

interface TabStripProps {
  tabs: Tab[];
  activeTabId: string;
  archivedCount: number;
  /** The tab whose settings dialog is open, if any. */
  infoTabId: string | null;
  /** Edge to draw the insertion bar on while a tab drag hovers. */
  drop: { tabId: string; side: "before" | "after" } | null;
  /** True while a card is in flight — pills become hover-to-focus targets. */
  isCardDragActive: boolean;
  onSelect: (tabId: string) => void;
  onOpenInfo: (tabId: string) => void;
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
  infoTabId,
  drop,
  isCardDragActive,
  onSelect,
  onOpenInfo,
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

  return (
    <div className="flex shrink-0 items-center gap-1 px-4 py-1.5">
      {/*
        Scrolls on its own rather than pushing Archived off the bar. `min-w-0`
        is what lets it actually shrink inside the flex row.
      */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <TabPill
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            isInfoOpen={infoTabId === tab.id}
            isCardDragActive={isCardDragActive}
            dropSide={drop?.tabId === tab.id ? drop.side : null}
            onSelect={() => onSelect(tab.id)}
            onOpenInfo={() => onOpenInfo(tab.id)}
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
      */}
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-muted-foreground"
        onClick={onOpenArchive}
      >
        <Archive aria-hidden />
        Archived
        {archivedCount > 0 && <span className="num">{archivedCount}</span>}
      </Button>
    </div>
  );
}

interface TabPillProps {
  tab: Tab;
  isActive: boolean;
  isInfoOpen: boolean;
  isCardDragActive: boolean;
  dropSide: "before" | "after" | null;
  onSelect: () => void;
  onOpenInfo: () => void;
}

function TabPill({
  tab,
  isActive,
  isInfoOpen,
  isCardDragActive,
  dropSide,
  onSelect,
  onOpenInfo,
}: TabPillProps) {
  const { setNodeRef, isOver } = useDroppable({ id: tabDropId(tab.id) });

  /**
   * Hovering a pill with a card in hand is a *focus* gesture, not a drop — the
   * card lands in a column afterwards. Highlighting it as though it were a drop
   * target would promise something releasing here does not deliver, so the
   * pending state is a ring, distinct from a column's filled target styling.
   */
  const isFocusCandidate = isCardDragActive && isOver && !isActive;

  const pill = (
    <div
      ref={setNodeRef}
      className={cn(
        "group/tab relative flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1",
        "transition-colors",
        isActive ? "bg-background shadow-xs" : "hover:bg-background/60",
        isFocusCandidate && "ring-2 ring-primary ring-offset-1 ring-offset-muted",
      )}
      style={
        // The tab's own colour wins over the neutral active treatment, so an
        // active coloured tab reads as itself rather than as "the active one".
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
          "max-w-40 truncate rounded text-xs outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          isActive ? "font-semibold" : "text-muted-foreground",
        )}
      >
        {tab.name}
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
          "size-4 text-muted-foreground/50 transition-opacity",
          "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100",
          isInfoOpen && "opacity-100",
        )}
      >
        <Info aria-hidden />
      </Button>

      {/*
        The colour underline, on every coloured tab rather than just the active
        one. A colour you can only see by selecting the tab cannot be used to
        find it, which is most of what a colour on a tab is for — so the strip
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
    </div>
  );

  if (!tab.description) return pill;

  return (
    <Tooltip>
      <TooltipTrigger render={pill} />
      <TooltipContent>{tab.description}</TooltipContent>
    </Tooltip>
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
        "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100",
        isDragging && "opacity-40",
      )}
      {...attributes}
      {...listeners}
    />
  );
}
