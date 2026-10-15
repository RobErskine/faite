// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewSettings } from "./view-settings";
import type { Settings } from "@/lib/schema";

/**
 * The controls write straight to the store, so the store is the assertion:
 * every case here is "this click produces exactly this patch".
 *
 * `mutateSettings` is mocked rather than run against fake-indexeddb because
 * what matters is the PATCH SHAPE — a status list rebuilt in the wrong order,
 * or a toggle that writes the value it already had, are the failures worth
 * catching, and both are invisible once Dexie has round-tripped them.
 */
const mutateSettings = vi.fn();
vi.mock("@/lib/store/mutate", () => ({
  mutateSettings: (...args: unknown[]) => mutateSettings(...args),
}));

const settings = (over: Partial<Settings> = {}): Settings => ({
  ownerId: "local-user",
  timezone: "UTC",
  workdaysOnly: false,
  workdays: [1, 2, 3, 4, 5],
  overflowAfterDays: 3,
  visibleDays: 7,
  visibleStatuses: ["open"],
  visibleEventKinds: ["created", "scheduled", "done", "dropped"],
  visibleActivityKinds: ["created", "scheduled", "unscheduled", "moved", "done", "dropped", "reopened", "edited", "deleted", "attached", "detached", "rolledOver", "overflowed"],
  visibleHistoryKinds: ["created", "scheduled", "unscheduled", "moved", "done", "dropped", "reopened", "edited", "deleted", "attached", "detached", "rolledOver", "overflowed"],
  hiddenEventKinds: null,
  hiddenActivityKinds: null,
  hiddenHistoryKinds: null,
  showWeekends: true,
  fontPairing: "hyperlegible",
  theme: "system",
  displayName: "",
  avatarKind: "initials",
  avatarInitials: "",
  avatarEmoji: "",
  avatarImage: "",
  activeTabId: null,
  backlogWidth: null,
  backlogCollapsed: false,
  overflowWidth: null,
  overflowCollapsed: false,
  splitRatio: null,
  splitCollapsed: "none",
  reminderPresetsSeeded: false,
  goodJobMode: false,
  holdAllDuplicates: false,
  smartSortEnabled: false,
  overdriveMinTodos: 5,
  overdriveAutoConfirmMs: 0,
  updatedAt: "2026-08-03T00:00:00.000Z",
  ...over,
});

/** Opens a dropdown and returns once its items are in the DOM. */
function openMenu(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

/** Trigger text. No jest-dom in this project — plain DOM reads throughout. */
const triggerText = (name: RegExp) =>
  screen.getByRole("button", { name }).textContent;

/** The patch from the most recent write, or undefined if nothing was written. */
const lastPatch = () => mutateSettings.mock.calls.at(-1)?.[1];

beforeEach(() => mutateSettings.mockClear());
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("ViewSettings — status filter", () => {
  it("labels the trigger with the selected statuses", () => {
    render(<ViewSettings settings={settings()} />);
    expect(triggerText(/which statuses/i)).toContain("View: To-do");
  });

  it("collapses to 'All' rather than listing three", () => {
    render(
      <ViewSettings settings={settings({ visibleStatuses: ["open", "done", "dropped"] })} />,
    );
    expect(triggerText(/which statuses/i)).toContain("View: All");
  });

  it("adds a status in the canonical order, not click order", async () => {
    render(<ViewSettings settings={settings({ visibleStatuses: ["dropped"] })} />);
    openMenu(/which statuses/i);
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "To-do" }));
    // Appending would give ["dropped", "open"], which then reads back as
    // "Marked as won't do, Todo" on the trigger.
    expect(lastPatch()).toEqual({ visibleStatuses: ["open", "dropped"] });
  });

  it("removes a status that is already on", async () => {
    render(<ViewSettings settings={settings({ visibleStatuses: ["open", "done"] })} />);
    openMenu(/which statuses/i);
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Completed" }));
    expect(lastPatch()).toEqual({ visibleStatuses: ["open"] });
  });

  /**
   * An empty board is a legal state that is indistinguishable from a broken
   * one — every column blank, no error, and the cause behind a menu that has
   * since closed.
   */
  it("refuses to turn off the last remaining status", async () => {
    render(<ViewSettings settings={settings({ visibleStatuses: ["open"] })} />);
    openMenu(/which statuses/i);
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "To-do" }));
    expect(mutateSettings).not.toHaveBeenCalled();
  });
});

describe("ViewSettings — day count", () => {
  it("shows the current count on the trigger", () => {
    render(<ViewSettings settings={settings({ visibleDays: 3 })} />);
    expect(triggerText(/how many day columns/i)).toContain("3 days");
  });

  it("writes the picked count as a number", async () => {
    render(<ViewSettings settings={settings()} />);
    openMenu(/how many day columns/i);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "5 days" }));
    // The radio group's value is a string; a stored "5" would fail the zod
    // `z.number()` on the next read.
    expect(lastPatch()).toEqual({ visibleDays: 5 });
  });

  it("marks the current value as checked", async () => {
    render(<ViewSettings settings={settings({ visibleDays: 5 })} />);
    openMenu(/how many day columns/i);
    const item = await screen.findByRole("menuitemradio", { name: "5 days" });
    expect(item.getAttribute("aria-checked")).toBe("true");
  });

  it("offers a singular 1-day option and writes it as a number", async () => {
    render(<ViewSettings settings={settings()} />);
    openMenu(/how many day columns/i);
    const item = await screen.findByRole("menuitemradio", { name: "1 day" });
    fireEvent.click(item);
    expect(lastPatch()).toEqual({ visibleDays: 1 });
  });
});

/**
 * EI-392. Weekends were a toggle button of their own in the date row; they
 * are a checkbox in the View menu now, worded like ⌘K's "Show weekends".
 */
describe("ViewSettings — weekends, in the View menu", () => {
  it("is checked while weekends show, and unchecking collapses them", async () => {
    render(<ViewSettings settings={settings()} />);
    expect(screen.queryByRole("button", { name: /^weekends/i })).toBeNull();
    openMenu(/which statuses/i);
    const item = await screen.findByRole("menuitemcheckbox", { name: "Show weekends" });
    expect(item.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(item);
    expect(lastPatch()).toEqual({ showWeekends: false });
  });

  it("is unchecked while they are collapsed, and checking brings them back", async () => {
    render(<ViewSettings settings={settings({ showWeekends: false })} />);
    openMenu(/which statuses/i);
    const item = await screen.findByRole("menuitemcheckbox", { name: "Show weekends" });
    expect(item.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(item);
    expect(lastPatch()).toEqual({ showWeekends: true });
  });
});

describe("ViewSettings — saved views, in the View menu (EI-392)", () => {
  beforeEach(() => localStorage.clear());

  it("holds the saved-views section under its own label", async () => {
    render(<ViewSettings settings={settings()} />);
    expect(screen.queryByRole("button", { name: "Saved views" })).toBeNull();
    openMenu(/which statuses/i);
    expect(await screen.findByText("Saved views")).toBeTruthy();
    expect(screen.getByText("No saved views yet")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "New saved view name" })).toBeTruthy();
  });
});

describe("ViewSettings — before Dexie resolves", () => {
  /**
   * `settings` is undefined for the first frames. Rendering the schema
   * defaults keeps the controls from flickering between two states, and
   * matters more than it sounds: the trigger widths shift the centered cluster.
   */
  it("renders the schema defaults rather than blanks", () => {
    render(<ViewSettings settings={undefined} />);
    expect(triggerText(/which statuses/i)).toContain("View: To-do");
    expect(triggerText(/how many day columns/i)).toContain("7 days");
  });

  /*
    WCAG 2.5.3 Label in Name (EI-377): a voice-control user says what they
    see, so each trigger's accessible name must contain its visible text.
  */
  it("names each trigger starting with its visible text", () => {
    render(<ViewSettings settings={settings({ visibleDays: 3 })} />);
    for (const name of [/which statuses/i, /how many day columns/i]) {
      const trigger = screen.getByRole("button", { name });
      const visible = trigger.textContent!.trim();
      expect(trigger.getAttribute("aria-label")!.startsWith(visible)).toBe(true);
    }
  });
});
