// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Todo } from "@/lib/schema";
import { clearFiredReminders, useReminders } from "./use-reminders";

/**
 * These cover one thing: that `clearFiredReminders()` actually clears.
 *
 * The fired set has two copies — one in localStorage, one in memory — and
 * `check()` writes the in-memory one back on every effect re-run. Clearing
 * only the persisted copy therefore does not hold: `clearDeviceData()` empties
 * the `todos` table, which changes `todos` identity, which re-runs the effect,
 * which re-persists the previous user's todo ids under a key sign-out had just
 * removed. That is a privacy leak with a millisecond-wide window, and it was
 * found in a browser rather than here — hence this file.
 */

const KEY = "faite:reminders-fired";

function Harness({ todos }: { todos: readonly Todo[] }) {
  useReminders(todos, "UTC");
  return null;
}

beforeEach(() => {
  localStorage.clear();
  // Reset the module-level set between tests.
  clearFiredReminders();
});

afterEach(cleanup);

describe("clearFiredReminders", () => {
  it("removes the persisted key", () => {
    localStorage.setItem(KEY, JSON.stringify(["todo-1:2099-01-01:09:00"]));

    clearFiredReminders();

    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("REGRESSION: the key does not come back when the board re-renders after a wipe", () => {
    // A mounted board that has already loaded the previous user's fired set.
    localStorage.setItem(KEY, JSON.stringify(["todo-1:2099-01-01:09:00"]));
    const { rerender } = render(<Harness todos={[]} />);
    expect(localStorage.getItem(KEY)).toContain("todo-1");

    clearFiredReminders();

    // What `clearDeviceData()` causes: the todos table empties, `useLiveQuery`
    // hands the board a new array, and the effect re-runs. Before the fix this
    // rewrote the key from the in-memory set, ids and all.
    rerender(<Harness todos={[]} />);

    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
