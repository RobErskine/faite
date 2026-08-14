"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ComponentType } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRightLeft,
  Calendar,
  CalendarOff,
  Check,
  ChevronDown,
  CornerDownRight,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownField } from "@/components/ui/markdown-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RepeatDialog } from "@/components/board/repeat-dialog";
import { RepeatSection, type RecurrenceInfo } from "@/components/board/repeat-section";
import { LocationField } from "@/components/board/location-field";
import { ListField } from "@/components/board/list-field";
import { LabelPicker } from "@/components/board/label-picker";
import { ReminderPicker } from "@/components/board/reminder-picker";
import { QuickAddPreview, type QuickAddChip } from "@/components/board/quick-add-preview";
import { MentionMenu, useMention, type MentionSource } from "@/components/mention-menu";
import type { MentionListOption, MentionPick } from "@/components/board/board-column";
import { TimelineList, TimelineRow } from "@/components/board/timeline";
import { cn } from "@/lib/utils";
import { edge } from "@/lib/colors";
import { TITLE_LINES } from "@/lib/title";
import { formatEventStamp } from "@/lib/event-time";
import { formatShortDate, type PlacementContext } from "@/lib/scheduling";
import { parseQuickAdd } from "@/lib/quick-add";
import { isTextEntry } from "@/lib/undo";
import { detectPlatform, formatCombo, type Platform } from "@/lib/keyboard";
import { createLabel } from "@/lib/store/repositories";
import type { TodoEventKind } from "@/lib/store/todo-events";
import {
  buildTodoTimeline,
  type RollSummaryPayload,
  type TodoTimelineEvent,
} from "@/lib/todo-timeline";
import type { RecurrenceRule } from "@/lib/recurrence";
import type {
  CivilDate,
  Label as LabelRecord,
  List,
  Place,
  Priority,
  Project,
  ReminderPreset,
  Tab,
  Todo,
  TodoEvent,
} from "@/lib/schema";

export type { RecurrenceInfo };

const NONE = "__none__";

/** Stable empty default for `listsById` — a fresh `new Map()` per render
 * would defeat memoization downstream for no reason. */
const EMPTY_LISTS_BY_ID: ReadonlyMap<string, List> = new Map();

interface TodoSheetProps {
  todo: Todo | null;
  /** For the title field's quick-add tokens (`p2`, `fri`, `2pm`, `!fri`) — see `commitTitle`. */
  today: CivilDate;
  lists: List[];
  /** Every live tab — see the List field, grouped into "{tabName} > {listName}" sections. */
  tabs: Tab[];
  labels: LabelRecord[];
  projects: Project[];
  /** Saved locations (`lib/schema.ts`'s `Place`) — see the Location field. */
  places: Place[];
  /** Named reminder times (EI-106) — see the Reminder field (`ReminderPicker`).
   * Optional, defaulting to none, same reasoning as `events` below. */
  reminderPresets?: ReminderPreset[];
  /** This todo's history log (EI-94) — the History section below Notes.
   * Optional (defaults to none) so callers/tests with nothing to show don't
   * have to thread empty collections through. */
  events?: TodoEvent[];
  timezone?: string;
  /**
   * The board's placement context — needed by the History section to derive
   * this todo's Faite Loop rows (EI-96, `rolledOver`/`overflowed`) the same
   * way the board derives its column. Optional so callers/tests with no
   * rollover to show don't have to thread it through; when omitted, History
   * simply shows no roll rows.
   */
  ctx?: PlacementContext;
  /** Live AND archived lists, so a `moved` event still colours its dot after
   * the target list is filed. Mirrors `DaySheet`'s `listsById`. */
  listsById?: ReadonlyMap<string, List>;
  onClose: () => void;
  onSave: (id: string, patch: Partial<Todo>) => void;
  /**
   * Status is separate from onSave because it is not a plain field write: it
   * also stamps `completedAt`. Routing it through onSave left that null on a
   * completed todo here while the card checkbox set it — the same action
   * producing two different records depending on where it was triggered.
   */
  onSetStatus: (id: string, status: Todo["status"]) => void;
  onToggleLabel: (todoId: string, labelId: string) => void;
  onDelete: (id: string) => void;
  /**
   * Set only when this sheet was opened from that day's timeline — renders a
   * "Back to Aug 11" affordance above the title. Absent for every other way of
   * reaching the sheet (a board card, the palette, Overflow), where there is
   * nowhere sensible to go back to.
   */
  backToDay?: CivilDate;
  onBackToDay?: () => void;
  /** Set when this todo is a materialized occurrence of a recurring series. */
  recurrence?: RecurrenceInfo | null;
  /**
   * Start a new series from this (plain, one-off) todo. Omitted — or simply
   * not rendered — when `recurrence` is already set, or the todo has no
   * `scheduledDate` to anchor a series on.
   */
  onStartSeries?: (rule: RecurrenceRule) => void;
}

/** Never changes within a page's life — same rationale as `useIsLocalDev` in settings-sheet.tsx. */
const subscribeToNothing = () => () => {};

/**
 * Display-only platform sniff, client-safe. `Platform` never gates
 * behaviour (the keyboard handler below checks the actual event's
 * modifiers), only which glyphs the footer tooltips show — but `navigator`
 * doesn't exist during the static export's prerender, so reading it
 * directly would still render one string server-side and swap in another on
 * hydration. `useSyncExternalStore` with an explicit server snapshot is the
 * sanctioned way to say "client-only" here — see `useIsLocalDev`.
 */
function usePlatform(): Platform {
  return useSyncExternalStore(subscribeToNothing, detectPlatform, () => "other");
}

/**
 * Full CRUD for a single todo.
 *
 * A Sheet rather than a Dialog: editing a todo is a side task next to the
 * board, and a sheet keeps the board visible for context. Radix handles focus
 * trapping, restore-on-close, and Escape for us.
 *
 * Fields write on blur/change rather than behind a Save button — writes are
 * local and instant, so there is nothing to batch and no request to await.
 */
export function TodoSheet({ todo, ...rest }: TodoSheetProps) {
  if (!todo) return null;
  // Keyed remount re-seeds the draft fields for each todo. Syncing them in an
  // effect instead would cascade renders (and React 19 lints against it).
  return <TodoSheetContent key={todo.id} todo={todo} {...rest} />;
}

function TodoSheetContent({
  todo,
  today,
  lists,
  tabs,
  labels,
  projects,
  places,
  reminderPresets = [],
  events = [],
  timezone = "UTC",
  ctx,
  listsById = EMPTY_LISTS_BY_ID,
  onClose,
  onSave,
  onSetStatus,
  onToggleLabel,
  onDelete,
  backToDay,
  onBackToDay,
  recurrence,
  onStartSeries,
}: TodoSheetProps & { todo: Todo }) {
  const [title, setTitle] = useState(todo.title);
  const [repeatDialogOpen, setRepeatDialogOpen] = useState(false);
  const platform = usePlatform();

  /**
   * "@list" and "#label" mentions in the title, resolving as an immediate
   * field write — matching every other control in this sheet (`ListField`,
   * the Labels toggle row below) rather than quick-add's "hold it until
   * commit" pattern, since this sheet is always editing a todo that already
   * exists. See `docs/AT-MENTION.md`.
   */
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [titleCursor, setTitleCursor] = useState(0);
  const pendingCaretRef = useRef<number | null>(null);

  const tabsById = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs]);
  const mentionListOptions = useMemo(
    (): MentionListOption[] =>
      lists.map((list) => ({
        id: list.id,
        name: list.name,
        color: list.color ?? (list.tabId ? (tabsById.get(list.tabId)?.color ?? null) : null),
      })),
    [lists, tabsById],
  );
  const mentionSources = useMemo((): MentionSource<MentionPick>[] => [
    {
      trigger: "@",
      items: mentionListOptions.map((list) => ({
        id: list.id,
        label: list.name,
        data: { kind: "list" as const, list },
      })),
    },
    {
      trigger: "#",
      // Already-applied labels are excluded — `onToggleLabel` is a toggle,
      // so mentioning one again would silently remove it.
      items: labels
        .filter((label) => !todo.labelIds.includes(label.id))
        .map((label) => ({
          id: label.id,
          label: label.emoji ? `${label.emoji} ${label.name}` : label.name,
          data: { kind: "label" as const, label },
        })),
      onNoMatch: (query) => ({
        id: "__create-label__",
        label: `Create label "${query}"`,
        data: { kind: "create-label" as const, name: query },
      }),
    },
  ], [mentionListOptions, labels, todo.labelIds]);
  const mention = useMention({ value: title, cursor: titleCursor, sources: mentionSources });

  useEffect(() => {
    if (pendingCaretRef.current === null) return;
    titleRef.current?.setSelectionRange(pendingCaretRef.current, pendingCaretRef.current);
    pendingCaretRef.current = null;
  });

  const syncTitleCursor = (el: HTMLTextAreaElement) =>
    setTitleCursor(el.selectionStart ?? el.value.length);

  const applyMention = async (resolved: ReturnType<typeof mention.resolve>) => {
    setTitle(resolved.text);
    setTitleCursor(resolved.caretIndex);
    pendingCaretRef.current = resolved.caretIndex;

    const pick = resolved.item.data;
    if (pick.kind === "list") onSave(todo.id, { listId: pick.list.id });
    else if (pick.kind === "label") onToggleLabel(todo.id, pick.label.id);
    else if (pick.kind === "create-label") {
      const id = await createLabel(pick.name);
      onToggleLabel(todo.id, id);
    }
  };

  /**
   * Same grammar quick-add uses to CREATE a todo (`p2`, `fri`, `2pm`, `!fri`
   * — see `lib/quick-add.ts`), reused here to UPDATE one: trailing tokens on
   * the title are stripped and applied as real field writes rather than left
   * as literal text. The one difference from creation: a field `parseQuickAdd`
   * didn't recognize stays `null`, and `null` here means "leave it alone" —
   * unlike a brand-new todo, this one may already have a priority or a
   * deadline that a title edit with no date token in it must not clobber.
   */
  const commitTitle = () => {
    const next = title.trim();
    if (!next) {
      setTitle(todo.title);
      return;
    }

    const parsed = parseQuickAdd(next, today);
    const patch: Partial<Todo> = {};
    if (parsed.matches.length > 0) {
      if (parsed.title !== todo.title) patch.title = parsed.title;
      if (parsed.priority !== null) patch.priority = parsed.priority;
      if (parsed.scheduledDate !== null) patch.scheduledDate = parsed.scheduledDate;
      if (parsed.deadline !== null) patch.deadline = parsed.deadline;
      if (parsed.reminderTime !== null) patch.reminderTime = parsed.reminderTime;
      setTitle(parsed.title);
    } else if (next !== todo.title) {
      patch.title = next;
    }

    if (Object.keys(patch).length > 0) onSave(todo.id, patch);
  };

  // Live feedback while typing, same as quick-add's row — teaches that a
  // trailing token is about to become a real field, not just get typed
  // literally into the title.
  const titleChips = useMemo((): QuickAddChip[] => {
    const parsed = parseQuickAdd(title, today);
    return parsed.matches.map((m) => ({ key: `${m.kind}:${m.raw}`, label: m.label }));
  }, [title, today]);

  const markDone = () => {
    onSetStatus(todo.id, todo.status === "done" ? "open" : "done");
    onClose();
  };
  const wontDo = () => {
    onSetStatus(todo.id, "dropped");
    onClose();
  };
  const remove = () => {
    onDelete(todo.id);
    onClose();
  };

  /**
   * Local `onKeyDown`, not a global registry entry — KEYBOARD.md §5 step 1:
   * these three actions are meaningless unless this sheet is open, and the
   * registry's `GuardContext` has no per-surface discriminator, so a global
   * entry would need `allowWhenModalOpen: true` and would ALSO fire behind
   * every other sheet/dialog in the app.
   *
   * `e.defaultPrevented` bails out from under an inner control that already
   * handled the key — the location combobox's Base UI popup is a React
   * child of this element (portals bubble through the React tree, not the
   * DOM tree), so selecting a suggestion with Enter would otherwise also
   * mark the todo done. `RepeatDialog` needs no such guard: it renders as a
   * SIBLING of this element, so its keystrokes never reach this handler.
   */
  const handleSheetKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    // Exactly one of Ctrl/Meta, never both, never Alt — the same rule
    // `hasExactModifiers` (lib/keyboard.ts) enforces for the global registry.
    // Hand-checked here because that helper only serves the registry.
    const modOnly = e.metaKey !== e.ctrlKey && !e.altKey;
    if (!modOnly) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      markDone();
      return;
    }

    if (e.key === "Backspace") {
      // `⌘⌫`/`Ctrl+Backspace` is "delete to line start" / "delete previous
      // word" in a text field on every platform — never steal it there.
      if (isTextEntry(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) remove();
      else wontDo();
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      {/*
        `data-[side=right]:` on the width utilities, not plain `sm:` ones: the
        base `SheetContent` already sets `data-[side=right]:w-3/4` and
        `data-[side=right]:sm:max-w-sm`, both gated on the same attribute
        selector. A plain class loses that specificity fight and silently
        does nothing — matching the modifier is what makes the override win.
        See the matching comment in `day-sheet.tsx`, which shares this sheet
        width so the two don't read as two different components.
      */}
      <SheetContent
        className="flex w-full flex-col gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[75ch]"
        onKeyDown={handleSheetKeyDown}
      >
        <SheetHeader className={backToDay ? "gap-1.5 pr-10" : undefined}>
          <SheetTitle className="sr-only">Edit to-do</SheetTitle>
          <SheetDescription className="sr-only">
            Edit the details of this to-do item.
          </SheetDescription>
          {backToDay && onBackToDay && (
            <button
              type="button"
              onClick={onBackToDay}
              className="-ml-1 flex w-fit items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <ArrowLeft className="size-3" aria-hidden />
              Back to {formatShortDate(backToDay)}
            </button>
          )}
          {/*
            A textarea, not an input, so a long title is readable here rather
            than scrolling sideways one line at a time — and it grows to exactly
            the card's clamp (`TITLE_LINES`) so what the sheet shows in full is
            what the card shows before cutting off.

            `field-sizing-content` (from the Textarea base) does the growing with
            no JS; `rows={1}` is the floor, and `max-h` the ceiling, past which it
            scrolls. Where `field-sizing` is unsupported this degrades to a
            one-row textarea, which is what an `<input>` was anyway.

            Enter still commits rather than inserting a newline: a title is one
            line of text, and `commitTitle` already runs on blur.
          */}
          <div className="relative">
            <Textarea
              ref={titleRef}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                syncTitleCursor(e.target);
              }}
              onSelect={(e) => syncTitleCursor(e.currentTarget)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (mention.isOpen) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    mention.moveHighlight(1);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    mention.moveHighlight(-1);
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const resolved = mention.resolveHighlighted();
                    if (resolved) void applyMention(resolved);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    mention.dismiss();
                    return;
                  }
                }

                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              rows={1}
              style={{ maxHeight: `calc(${TITLE_LINES} * 1.5rem)` }}
              aria-label="Title"
              className={cn(
                "min-h-0 resize-none border-0 px-0 py-0 text-base font-medium leading-6",
                "shadow-none focus-visible:border-0 focus-visible:ring-0",
              )}
            />
            {mention.isOpen && (
              <MentionMenu
                results={mention.results}
                highlightedIndex={mention.highlightedIndex}
                onHighlight={mention.setHighlightedIndex}
                onSelect={(item) => void applyMention(mention.resolve(item))}
                side="down"
                ariaLabel={mention.sigil === "#" ? "Labels" : "Lists"}
              />
            )}
          </div>
          <QuickAddPreview chips={titleChips} className="px-0 pt-1 pb-0" />
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="todo-scheduled">Date</Label>
              <Input
                id="todo-scheduled"
                type="date"
                value={todo.scheduledDate ?? ""}
                onChange={(e) => {
                  const next = e.target.value || null;
                  // Clearing the date orphans any reminder — it resolves
                  // against `scheduledDate` (lib/reminders.ts) and would
                  // otherwise silently resurrect the moment a date is set
                  // again.
                  onSave(
                    todo.id,
                    next
                      ? { scheduledDate: next }
                      : { scheduledDate: null, reminderTime: null },
                  );
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="todo-deadline">Deadline</Label>
              <Input
                id="todo-deadline"
                type="date"
                value={todo.deadline ?? ""}
                onChange={(e) => onSave(todo.id, { deadline: e.target.value || null })}
              />
            </div>
          </div>

          {/* Gated behind scheduledDate — a preset is a time of day; with no
              date there is nothing for zonedInstant to resolve against
              (EI-106 decision 5, unchanged from EI-88). */}
          {todo.scheduledDate && (
            <ReminderPicker todo={todo} presets={reminderPresets} onSave={onSave} />
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="todo-list">List</Label>
              <ListField todo={todo} lists={lists} tabs={tabs} onSave={onSave} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="todo-priority">Priority</Label>
              <Select
                value={todo.priority ? String(todo.priority) : NONE}
                onValueChange={(v) =>
                  onSave(todo.id, {
                    priority: v === NONE ? null : (Number(v) as Priority),
                  })
                }
              >
                <SelectTrigger id="todo-priority">
                  {/* Base UI's SelectValue shows the raw `value` string by
                      default ("1" rather than "P1") unless given a way to
                      resolve a label — see ListField's comment for the fuller
                      explanation. */}
                  <SelectValue>
                    {(value: string) => (value === NONE ? "None" : `P${value}`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {[1, 2, 3, 4].map((p) => (
                    <SelectItem key={p} className="num" value={String(p)}>
                      P{p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="todo-project">Project</Label>
            <Select
              value={todo.projectId ?? NONE}
              onValueChange={(v) =>
                onSave(todo.id, { projectId: v === NONE ? null : v })
              }
            >
              <SelectTrigger id="todo-project">
                <SelectValue>
                  {(value: string) => {
                    if (value === NONE) return "None";
                    // `deleteProject` clears every referencing todo's
                    // `projectId` (repositories.ts), so an unresolved id here
                    // would mean a genuinely different bug — not the
                    // archived-list case `ListField` guards against — but
                    // falling back rather than leaking the raw id costs
                    // nothing.
                    const project = projects.find((p) => p.id === value);
                    if (!project) return "None";
                    return project.emoji ? `${project.emoji} ${project.name}` : project.name;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.emoji ? `${project.emoji} ` : ""}
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <LabelPicker todo={todo} labels={labels} onToggleLabel={onToggleLabel} />

          <LocationField todo={todo} places={places} onSave={onSave} />

          {recurrence ? (
            <RepeatSection recurrence={recurrence} />
          ) : (
            onStartSeries &&
            todo.scheduledDate && (
              <div className="space-y-1.5">
                <Label>Repeat</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRepeatDialogOpen(true)}
                  className="w-fit"
                >
                  <Repeat className="size-3.5" aria-hidden />
                  Repeat…
                </Button>
              </div>
            )
          )}

          <Separator />

          <div className="space-y-1.5">
            <Label>Notes</Label>
            {/*
              Markdown, finally rendered rather than just stored — the field has
              declared itself markdown since P1 (`todoSchema.description`) while
              being a plain textarea. `MarkdownField` seeds once per mount, which
              is why `TodoSheet` keys this whole subtree by todo id.

              Last in the scroll body, not first: at `min-h-40` it can grow
              freely under whatever is typed without burying the metadata
              above it — the fields this whole section exists to make more
              usable (Location, Repeat) would otherwise sit a deliberate
              half-screen scroll away.
            */}
            <MarkdownField
              value={todo.description ?? ""}
              placeholder="Add notes"
              ariaLabel="Notes"
              className="min-h-40"
              onCommit={(next) =>
                onSave(todo.id, { description: next.trim() ? next : null })
              }
            />
          </div>

          <Separator />

          <HistorySection
            todo={todo}
            events={events}
            timezone={timezone}
            ctx={ctx}
            listsById={listsById}
          />
        </div>

        {/*
          3-up, not stacked: `SheetFooter` is `flex-col` by default (one
          button had no reason to fight that), so this overrides to a row and
          gives each button an equal third.
        */}
        <SheetFooter className="grid grid-cols-3 gap-2 border-t">
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="sm" onClick={markDone} />}>
              {todo.status === "done" ? "Reopen" : "Mark done"}
            </TooltipTrigger>
            <TooltipContent>
              {todo.status === "done" ? "Reopen" : "Mark done"}
              <kbd data-slot="kbd" className="rounded border border-background/30 px-1 font-mono text-2xs">
                {formatCombo("mod+enter", platform)}
              </kbd>
            </TooltipContent>
          </Tooltip>
          {/*
            "Won't do" is a distinct status from done, not a delete. It keeps
            the item in history as abandoned rather than completed.
          */}
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="sm" onClick={wontDo} />}>
              Won&apos;t do
            </TooltipTrigger>
            <TooltipContent>
              Won&apos;t do
              <kbd data-slot="kbd" className="rounded border border-background/30 px-1 font-mono text-2xs">
                {formatCombo("mod+backspace", platform)}
              </kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={remove}
                />
              }
            >
              <Trash2 className="size-4" aria-hidden />
              Delete
            </TooltipTrigger>
            <TooltipContent>
              {recurrence ? "Skip this occurrence" : "Delete"}
              <kbd data-slot="kbd" className="rounded border border-background/30 px-1 font-mono text-2xs">
                {formatCombo("shift+mod+backspace", platform)}
              </kbd>
            </TooltipContent>
          </Tooltip>
        </SheetFooter>
      </SheetContent>

      {onStartSeries && todo.scheduledDate && (
        <RepeatDialog
          open={repeatDialogOpen}
          onOpenChange={setRepeatDialogOpen}
          seriesStart={todo.scheduledDate}
          initialRule={null}
          onSave={onStartSeries}
        />
      )}
    </Sheet>
  );
}

/**
 * `rolledOver`/`overflowed` (EI-96, the Faite Loop) are never written —
 * `buildTodoTimeline` synthesizes them from `scheduledDate` the same way the
 * board derives placement — so they have no counterpart in `TodoEventKind`
 * (`lib/store/todo-events.ts`), which enumerates only real write-path kinds.
 */
type HistoryEventKind = TodoEventKind | "rolledOver" | "overflowed";

/**
 * Human labels/icons for the todo history log's kinds (EI-94) — a different
 * vocabulary from the day sheet's `EVENT_LABEL`/`EVENT_ICON`
 * (`day-sheet.tsx`), which cover only 6 kinds and word `scheduled` as
 * "Assigned here" (a referent — "here" — this sheet doesn't have).
 *
 * A `kind` outside this map (a newer build's event, read on an older cached
 * bundle) falls back to a neutral "Updated" row rather than throwing — see
 * `todoEventSchema`'s doc comment in `lib/schema.ts` for why `kind` is
 * `z.string()`, not an enum.
 */
const HISTORY_EVENT_LABEL: Partial<Record<HistoryEventKind, string>> = {
  created: "Created",
  scheduled: "Scheduled",
  unscheduled: "Unscheduled",
  moved: "Moved",
  done: "Completed",
  dropped: "Won't do",
  reopened: "Reopened",
  edited: "Edited",
  deleted: "Deleted",
  rolledOver: "Rolled over",
  overflowed: "Fell into Overflow",
};

const HISTORY_EVENT_ICON: Partial<Record<HistoryEventKind, ComponentType<{ className?: string; "aria-hidden"?: boolean }>>> = {
  created: Plus,
  scheduled: Calendar,
  unscheduled: CalendarOff,
  moved: ArrowRightLeft,
  done: Check,
  dropped: X,
  reopened: RotateCcw,
  edited: Pencil,
  deleted: Trash2,
  rolledOver: CornerDownRight,
  overflowed: Archive,
};

const FALLBACK_LABEL = "Updated";
const FALLBACK_ICON = Pencil;

/** Field names -> the label they read as in an `edited` row's detail line. */
const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Notes",
  priority: "Priority",
  deadline: "Deadline",
  reminderTime: "Reminder",
  scheduledDate: "Date",
  listId: "List",
  projectId: "Project",
  location: "Location",
  placeId: "Place",
  recurrenceRule: "Repeat rule",
};

/** The optional one-line detail under `moved`/`scheduled`/`edited`/rollover
 * rows — everything else is fully said by the meta line alone. */
function historyDetail(event: TodoTimelineEvent): string | null {
  if (event.kind === "moved") {
    const payload = event.payload as { toListId?: string | null; toListName?: string | null } | null;
    return `→ ${payload?.toListName ?? "Backlog"}`;
  }
  if (event.kind === "scheduled") {
    const payload = event.payload as { to?: CivilDate | null } | null;
    return payload?.to ? `→ ${formatShortDate(payload.to)}` : null;
  }
  if (event.kind === "edited") {
    const fields = event.fields ?? [];
    if (fields.length === 0) return null;
    return fields.map((field) => FIELD_LABELS[field] ?? field).join(", ");
  }
  if (event.kind === "rolledOver" || event.kind === "overflowed") {
    const payload = event.payload as RollSummaryPayload | null;
    if (!payload) return null;
    const days = payload.rolls === 1 ? "1 day" : `${payload.rolls} days`;
    return event.kind === "rolledOver"
      ? `${days}, from ${formatShortDate(payload.from)}`
      : `from ${formatShortDate(payload.from)}`;
  }
  return null;
}

/** The accent dot uses the list FROM THE PAYLOAD, not the todo's current
 * list — otherwise every dot on a single todo's timeline is the same
 * colour and says nothing about what actually happened. Every other kind
 * has no natural list association, so it gets no accent. */
function historyAccent(
  event: TodoTimelineEvent,
  listsById: ReadonlyMap<string, List>,
): string | undefined {
  if (event.kind !== "moved") return undefined;
  const payload = event.payload as { toListId?: string | null } | null;
  const list = payload?.toListId ? listsById.get(payload.toListId) : undefined;
  return edge(list?.color);
}

interface HistorySectionProps {
  todo: Todo;
  events: TodoEvent[];
  timezone: string;
  /** Omitted renders the real log alone — no Faite Loop rows. See the note
   * on `TodoSheetProps.ctx`. */
  ctx?: PlacementContext;
  listsById: ReadonlyMap<string, List>;
}

/**
 * Behind a disclosure with a count in the heading, open by default — a
 * todo's history is usually exactly what someone opening the sheet wants to
 * see, so it no longer costs an extra click to reveal.
 */
function HistorySection({ todo, events, timezone, ctx, listsById }: HistorySectionProps) {
  const [open, setOpen] = useState(true);
  const items = useMemo(
    () => buildTodoTimeline(events, todo, ctx, timezone),
    [events, todo, ctx, timezone],
  );
  const count = items.filter((item) => item.type === "event").length;

  return (
    <section className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 transition-transform", !open && "-rotate-90")}
        />
        History ({count})
      </button>

      {open && (
        <TimelineList ariaLabel={`History for ${todo.title}`}>
          {items.map((item, index) => {
            if (item.type === "marker") {
              return (
                <li key={item.key} className="pl-6 text-2xs text-muted-foreground">
                  — History recorded from here —
                </li>
              );
            }
            const { event } = item;
            const Icon =
              HISTORY_EVENT_ICON[event.kind as HistoryEventKind] ?? FALLBACK_ICON;
            const label = HISTORY_EVENT_LABEL[event.kind as HistoryEventKind] ?? FALLBACK_LABEL;
            const detail = historyDetail(event);
            return (
              <TimelineRow
                key={event.key}
                icon={Icon}
                label={label}
                at={event.at}
                when={formatEventStamp(event.at, timezone)}
                accent={historyAccent(event, listsById)}
                isLast={index === items.length - 1}
              >
                {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
              </TimelineRow>
            );
          })}
        </TimelineList>
      )}
    </section>
  );
}
