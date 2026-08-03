// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CommandPalette } from "./command-palette";
import type { List, Settings } from "@/lib/schema";

/**
 * Regression guard for the ⌘K crash.
 *
 * shadcn's CommandDialog renders its children straight into DialogContent
 * without wrapping them in <Command>, so cmdk's Input had no store to
 * subscribe to and threw "Cannot read properties of undefined (reading
 * 'subscribe')" the moment the palette opened.
 *
 * Mounting it open is enough to catch that class of bug: a missing context
 * fails at render, not on interaction.
 */

const list = (id: string, name: string, isBacklog = false): List => ({
  id,
  ownerId: "local-user",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  deletedAt: null,
  name,
  isBacklog,
  position: "a0",
  tabId: null,
  color: null,
  emoji: null,
  iconUrl: null,
});

const settings: Settings = {
  ownerId: "local-user",
  timezone: "UTC",
  workdaysOnly: false,
  workdays: [1, 2, 3, 4, 5],
  overflowAfterDays: 3,
  visibleDays: 7,
  updatedAt: "2026-08-03T00:00:00.000Z",
};

const LISTS = [list("l1", "Backlog", true), list("l2", "Grocery List")];

// Not using vitest globals, so RTL's automatic cleanup does not run. Without
// this, each render leaks into the next test's DOM queries.
afterEach(cleanup);

describe("CommandPalette", () => {
  it("mounts open without throwing", () => {
    expect(() =>
      render(
        <CommandPalette
          open
          onOpenChange={() => {}}
          lists={LISTS}
          settings={settings}
        />,
      ),
    ).not.toThrow();
  });

  it("renders the search input and root commands", () => {
    render(
      <CommandPalette
        open
        onOpenChange={() => {}}
        lists={LISTS}
        settings={settings}
      />,
    );

    expect(
      screen.getByPlaceholderText("Type a command or search…"),
    ).toBeTruthy();
    expect(screen.getByText("New to-do")).toBeTruthy();
    expect(screen.getByText("New list")).toBeTruthy();
    expect(screen.getByText("Delete a list…")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    render(
      <CommandPalette
        open={false}
        onOpenChange={() => {}}
        lists={LISTS}
        settings={settings}
      />,
    );
    expect(screen.queryByText("New to-do")).toBeNull();
  });
});
