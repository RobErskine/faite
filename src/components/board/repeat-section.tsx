"use client";

import { useState } from "react";
import { MoreHorizontal, Repeat as RepeatIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RepeatDialog } from "./repeat-dialog";
import { formatShortDate } from "@/lib/scheduling";
import { summarizeEnd, summarizeSchedule, type RecurrenceRule } from "@/lib/recurrence";
import type { CivilDate } from "@/lib/schema";

/**
 * Read-only detail of the series a materialized (or virtual) occurrence
 * belongs to, plus its three mutating actions. `openTodo` alone never
 * carries this — the rule lives on the template, found through
 * `recurrenceParentId` — so the caller (`board.tsx`) assembles it.
 */
export interface RecurrenceInfo {
  rule: RecurrenceRule;
  /** The template's own scheduledDate — anchors the schedule summary. */
  seriesStart: CivilDate;
  /**
   * The occurrence currently open. Distinct from `seriesStart`: a "Change…"
   * edit retargets the series to begin HERE (see `retargetSeries`), which is
   * very often a later date than where the series originally started.
   */
  occurrenceDate: CivilDate;
  /** "Every week on Fri, until Dec 31" — the one-line legacy summary. */
  summary: string;
  /** Null when the rule has no occurrences left, or `anchor` is "completed". */
  nextDate: CivilDate | null;
  /** Occurrences currently outstanding on this card. Null hides the badge. */
  missedCount: number | null;
  /** Ends the series after this occurrence — keeps history, stops future ones. */
  onStop: () => void;
  /** Retargets the series to a new rule starting at `occurrenceDate`. */
  onChangeRule: (rule: RecurrenceRule) => void;
  /** Deletes the whole series. Materialized occurrences survive as plain todos. */
  onRemoveSeries: () => void;
}

interface RepeatSectionProps {
  recurrence: RecurrenceInfo;
}

/**
 * The repeat block: schedule, end condition, next occurrence, and the three
 * verbs — Change (retarget from here), Stop (keep history, no more
 * occurrences), Delete (remove the series entirely).
 *
 * "Stop repeating" and "Delete repeating" are deliberately two different
 * actions, not one. Stopping keeps every completed occurrence as history and
 * simply lets the series lapse; deleting removes the series outright. See
 * `retargetSeries`/`deleteSeries` (`lib/store/repositories.ts`) for exactly
 * what each does to already-materialized children.
 */
export function RepeatSection({ recurrence }: RepeatSectionProps) {
  const [changeOpen, setChangeOpen] = useState(false);
  // Bumped on every "Change…" click so `RepeatDialog` gets a fresh `key` —
  // it seeds its draft state once per mount and does not track prop changes
  // afterward, so without this a cancelled edit reopens showing the
  // abandoned draft rather than the saved rule.
  const [changeGeneration, setChangeGeneration] = useState(0);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const openChangeDialog = () => {
    setChangeGeneration((g) => g + 1);
    setChangeOpen(true);
  };

  const nextLine = recurrence.nextDate
    ? `Next: ${formatShortDate(recurrence.nextDate)}`
    : recurrence.rule.anchor === "completed"
      ? "Next: once you complete this one"
      : "No more occurrences";

  return (
    <div className="space-y-1.5">
      <Label>Repeat</Label>
      <div className="space-y-2 rounded-md border px-3 py-2 text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <RepeatIcon className="size-3.5 shrink-0" aria-hidden />
          <span>{summarizeSchedule(recurrence.rule, recurrence.seriesStart)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{summarizeEnd(recurrence.rule)}</span>
          <span>{nextLine}</span>
          {recurrence.missedCount !== null && recurrence.missedCount > 1 && (
            <Badge variant="outline">×{recurrence.missedCount}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={openChangeDialog}>
            Change…
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="More repeat actions" />}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={recurrence.onStop}>Stop repeating</DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmDeleteOpen(true)}
              >
                Delete repeating
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <RepeatDialog
        key={changeGeneration}
        open={changeOpen}
        onOpenChange={setChangeOpen}
        seriesStart={recurrence.occurrenceDate}
        initialRule={recurrence.rule}
        onSave={recurrence.onChangeRule}
        title="Edit repeat"
      />

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this repeating to-do?</AlertDialogTitle>
            <AlertDialogDescription>
              Future occurrences will stop appearing. Anything you&apos;ve
              already completed stays in your history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                recurrence.onRemoveSeries();
                setConfirmDeleteOpen(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
