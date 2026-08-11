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
    expect(triggerText(/which statuses/i)).toContain("View: Todo");
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
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Todo" }));
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
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Todo" }));
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
});

describe("ViewSettings — weekends", () => {
  /**
   * The label states what you are LOOKING AT, not what the click does — it sits
   * between two dropdowns that both report the current view, and an action
   * label there reads as a claim about the board.
   */
  it("says 'Weekends' when they are showing, and toggles them off", () => {
    render(<ViewSettings settings={settings()} />);
    const button = screen.getByRole("button", { name: "Weekends" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(lastPatch()).toEqual({ showWeekends: false });
  });

  it("says 'Weekends hidden' when they are not, and toggles them back", () => {
    render(<ViewSettings settings={settings({ showWeekends: false })} />);
    const button = screen.getByRole("button", { name: "Weekends hidden" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(lastPatch()).toEqual({ showWeekends: true });
  });
});

describe("ViewSettings — before Dexie resolves", () => {
  /**
   * `settings` is undefined for the first frames. Rendering the schema
   * defaults keeps the controls from flickering between two states, and
   * matters more than it sounds: the trigger widths shift the centred cluster.
   */
  it("renders the schema defaults rather than blanks", () => {
    render(<ViewSettings settings={undefined} />);
    expect(triggerText(/which statuses/i)).toContain("View: Todo");
    expect(triggerText(/how many day columns/i)).toContain("7 days");
    expect(screen.getByRole("button", { name: "Weekends" })).toBeTruthy();
  });
});
