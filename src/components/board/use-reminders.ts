"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Todo } from "@/lib/schema";
import { dueReminders, reminderFireKey } from "@/lib/reminders";
import { todayIn } from "@/lib/scheduling";

const FIRED_STORAGE_KEY = "faite:reminders-fired";
const POLL_MS = 30_000;

function loadFired(): Set<string> {
  try {
    const raw = localStorage.getItem(FIRED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v) => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function saveFired(fired: ReadonlySet<string>): void {
  try {
    localStorage.setItem(FIRED_STORAGE_KEY, JSON.stringify([...fired]));
  } catch {
    // Best effort — a full-in-memory set still keeps this session correct
    // even if it can't survive a reload.
  }
}

/** Drops keys for dates before today, so the set can't grow forever. */
function pruneFired(fired: ReadonlySet<string>, today: string): Set<string> {
  const pruned = new Set<string>();
  for (const key of fired) {
    // Fire keys are `${id}:${date}:${time}` — date is the second field.
    const date = key.split(":")[1];
    if (date && date >= today) pruned.add(key);
  }
  return pruned;
}

/**
 * `tag` set to a stable per-todo value, so two open tabs collapse into one
 * visible notification instead of stacking a duplicate for each.
 */
function deliver(todo: Todo): void {
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(todo.title, {
        body: "Reminder",
        tag: `faite-reminder-${todo.id}`,
      });
      return;
    } catch {
      // Fall through to the toast — some browsers throw constructing a
      // Notification outside a service-worker registration.
    }
  }
  // The primary channel, not just a fallback, on iOS Safari outside an
  // installed PWA — `Notification` is absent there entirely.
  toast(todo.title, { description: "Reminder", duration: 10_000 });
}

/**
 * Polls for due reminders while the app is open and delivers each once.
 *
 * A 30s interval plus `visibilitychange`/`focus`, not a per-todo
 * `setTimeout`: `setTimeout` clamps at ~24.8 days and fires IMMEDIATELY past
 * that ceiling, and a backgrounded tab throttles or freezes timers outright.
 * A wall-clock comparison on every tick survives both, and sleep.
 */
export function useReminders(todos: readonly Todo[], timezone: string): void {
  const firedRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    firedRef.current ??= loadFired();

    const check = () => {
      const today = todayIn(timezone);
      const fired = pruneFired(firedRef.current!, today);
      const due = dueReminders(todos, today, new Date().toISOString(), timezone, fired);
      for (const todo of due) {
        deliver(todo);
        fired.add(reminderFireKey(todo));
      }
      firedRef.current = fired;
      saveFired(fired);
    };

    check();
    const interval = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [todos, timezone]);
}

/** Feature-detected: iOS Safari outside an installed PWA has no `Notification` at all. */
export function notificationsSupported(): boolean {
  return typeof Notification !== "undefined";
}

export type NotificationSupportState = NotificationPermission | "unsupported";

export function notificationPermissionState(): NotificationSupportState {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

/**
 * Must be called from a user gesture (a click handler) — Safari silently
 * ignores `requestPermission()` calls made any other way, which is why this
 * is a button in Settings rather than something requested on mount.
 */
export async function requestNotificationPermission(): Promise<NotificationSupportState> {
  if (!notificationsSupported()) return "unsupported";
  return Notification.requestPermission();
}
