"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dayOfWeek } from "@/lib/scheduling";
import {
  defaultRule,
  type RecurrenceAnchor,
  type RecurrenceFreq,
  type RecurrenceRule,
} from "@/lib/recurrence";
import type { CivilDate } from "@/lib/schema";

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const FREQ_ORDER: RecurrenceFreq[] = ["daily", "weekly", "monthly", "yearly"];
const FREQ_LABEL: Record<RecurrenceFreq, string> = {
  daily: "Day",
  weekly: "Week",
  monthly: "Month",
  yearly: "Year",
};

interface RepeatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Anchors the rule's alignment — e.g. which weekday "Every week" defaults to. */
  seriesStart: CivilDate;
  /** Null for a brand new series; the current rule when editing one. */
  initialRule: RecurrenceRule | null;
  onSave: (rule: RecurrenceRule) => void;
  /** @default "Custom repeat" */
  title?: string;
}

/**
 * The custom-repeat editor: Based on / Every / On / Ends. Draft state only —
 * nothing writes until Save, so Cancel (or the dialog's own close button)
 * discards every change.
 *
 * Draft state is seeded ONCE, on mount — it does not track `initialRule`
 * after that. Callers that reopen this for a series that already has a rule
 * must force a fresh mount each time (e.g. a `key` that changes on every
 * open), or a previous edit's abandoned draft reappears instead of the
 * saved rule. See `repeat-section.tsx` / `todo-sheet.tsx` for the pattern.
 */
export function RepeatDialog({
  open,
  onOpenChange,
  seriesStart,
  initialRule,
  onSave,
  title = "Custom repeat",
}: RepeatDialogProps) {
  const seed = initialRule ?? defaultRule(seriesStart);
  const [anchor, setAnchor] = useState<RecurrenceAnchor>(seed.anchor);
  const [interval, setIntervalValue] = useState(seed.interval);
  const [freq, setFreq] = useState<RecurrenceFreq>(seed.freq);
  const [byDay, setByDay] = useState<number[]>(
    seed.byDay.length > 0 ? seed.byDay : [dayOfWeek(seriesStart)],
  );
  const [ends, setEnds] = useState<"never" | "onDate">(seed.until ? "onDate" : "never");
  const [until, setUntil] = useState<CivilDate>(seed.until ?? seriesStart);

  const toggleDay = (day: number) => {
    setByDay((prev) =>
      prev.includes(day)
        ? // Never let the last checked day be unchecked — a weekly rule needs
          // at least one, and the alternative (falling back to "every day of
          // the week") is not what an empty selection should mean here.
          prev.length > 1
          ? prev.filter((d) => d !== day)
          : prev
        : [...prev, day].sort((a, b) => a - b),
    );
  };

  const handleSave = () => {
    const rule: RecurrenceRule = {
      v: 1,
      freq,
      interval: Math.max(1, interval),
      byDay: freq === "weekly" ? byDay : [],
      anchor,
      until: ends === "onDate" ? until : null,
      count: null,
    };
    onSave(rule);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Based on</Label>
            <RadioGroup
              value={anchor}
              onValueChange={(v) => setAnchor(v as RecurrenceAnchor)}
              className="gap-2"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="scheduled" /> Scheduled date
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="completed" /> Completed date
              </label>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="repeat-interval">Every</Label>
            <div className="flex gap-2">
              <Input
                id="repeat-interval"
                type="number"
                min={1}
                value={interval}
                onChange={(e) =>
                  setIntervalValue(Math.max(1, Number(e.target.value) || 1))
                }
                className="w-20"
              />
              <Select value={freq} onValueChange={(v) => setFreq(v as RecurrenceFreq)}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQ_ORDER.map((f) => (
                    <SelectItem key={f} value={f}>
                      {FREQ_LABEL[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {freq === "weekly" && (
            <div className="space-y-2">
              <Label>On</Label>
              <div className="flex flex-wrap gap-3">
                {WEEKDAYS.map((day) => (
                  <label key={day.value} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={byDay.includes(day.value)}
                      onCheckedChange={() => toggleDay(day.value)}
                    />
                    {day.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Ends</Label>
            <RadioGroup
              value={ends}
              onValueChange={(v) => setEnds(v as "never" | "onDate")}
              className="gap-2"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="never" /> Never
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="onDate" /> On date (inclusive)
              </label>
            </RadioGroup>
            {ends === "onDate" && (
              <Input
                type="date"
                value={until}
                min={seriesStart}
                onChange={(e) => e.target.value && setUntil(e.target.value)}
                className="mt-1"
                aria-label="Ends on date"
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
