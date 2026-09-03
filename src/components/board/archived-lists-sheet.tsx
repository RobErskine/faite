"use client";

import { useMemo } from "react";
import { Undo2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { tint } from "@/lib/colors";
import type { List, Tab, Todo } from "@/lib/schema";

/**
 * `archivedAt` is an ISO instant, not a civil date, so the civil-date
 * formatters in lib/scheduling.ts cannot read it — they parse "YYYY-MM-DD" at
 * UTC noon. Built once at module scope, matching that file's convention, and
 * left on the device's own zone: this is a record of when you did something,
 * not a scheduling decision.
 */
const ARCHIVED_ON = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const formatArchivedAt = (instant: string | null): string => {
  if (!instant) return "";
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? "" : ARCHIVED_ON.format(date);
};

interface ArchivedListsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Archived lists, already ordered newest-first by useArchivedLists. */
  lists: List[];
  /** Archived tabs, likewise newest-first. */
  tabs: Tab[];
  /** Every live to-do. Counted here rather than upstream — see below. */
  todos: Todo[];
  onRestore: (list: List) => void;
  onRestoreTab: (tab: Tab) => void;
}

/**
 * The archive: lists that have been put away, and the way back.
 *
 * A sheet rather than a page because the archive is a place you visit to fetch
 * something and leave — the board stays visible behind it, which is the context
 * that makes "should this come back?" answerable.
 */
export function ArchivedListsSheet({
  open,
  onOpenChange,
  lists,
  tabs,
  todos,
  onRestore,
  onRestoreTab,
}: ArchivedListsSheetProps) {
  /**
   * Open to-dos per archived list.
   *
   * Counted from the full to-do set, not the board's, because archiving is
   * exactly what removes these from the board — deriving the count there would
   * report zero for every row. Open-only matches what a restored column would
   * actually show: `buildBoard` drops completed and dropped to-dos.
   */
  const counts = useMemo(() => {
    const byList = new Map<string, number>();
    for (const todo of todos) {
      if (todo.status !== "open" || !todo.listId) continue;
      byList.set(todo.listId, (byList.get(todo.listId) ?? 0) + 1);
    }
    return byList;
  }, [todos]);

  /**
   * Lists per archived tab.
   *
   * Counted from the archived lists rather than the live ones, because a tab
   * takes its lists into the archive with it — every list this counts is
   * sitting in the section directly below.
   */
  const listsPerTab = useMemo(() => {
    const byTab = new Map<string, number>();
    for (const list of lists) {
      if (!list.tabId) continue;
      byTab.set(list.tabId, (byTab.get(list.tabId) ?? 0) + 1);
    }
    return byTab;
  }, [lists]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-sm">
        {/* Leaves room for the close button pinned at the top right. */}
        <SheetHeader className="pr-10">
          <SheetTitle>Archived</SheetTitle>
          <SheetDescription className="text-xs">
            Tabs and lists you have put away. Everything inside came with them
            and returns intact.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {/*
            Tabs first, and only when there are any. Restoring a tab brings its
            lists back with it, so offering it above the lists section saves
            restoring them one at a time — and the section disappears entirely
            when it is empty rather than showing a second "nothing here".
          */}
          {tabs.length > 0 && (
            <section className="pb-2">
              <h3 className="py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tabs
              </h3>
              <ul className="divide-y">
                {tabs.map((tab) => {
                  const count = listsPerTab.get(tab.id) ?? 0;
                  return (
                    <li key={tab.id} className="flex items-center gap-3 py-3">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full border"
                        style={{ backgroundColor: tint(tab.color) }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{tab.name}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="num">{count}</span>
                          {count === 1 ? " list" : " lists"}
                          {" · "}
                          <span className="num">
                            {formatArchivedAt(tab.archivedAt)}
                          </span>
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onRestoreTab(tab)}
                      >
                        <Undo2 aria-hidden />
                        Restore
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {tabs.length > 0 && (
            <h3 className="py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Lists
            </h3>
          )}

          {lists.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No archived lists.
            </p>
          ) : (
            <ul className="divide-y">
              {lists.map((list) => {
                const count = counts.get(list.id) ?? 0;
                return (
                  <li key={list.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate type-column-title text-sm">
                        {list.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className="num">{count}</span>
                        {count === 1 ? " item" : " items"}
                        {" · "}
                        <span className="num">
                          {formatArchivedAt(list.archivedAt)}
                        </span>
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRestore(list)}
                    >
                      <Undo2 aria-hidden />
                      Restore
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
