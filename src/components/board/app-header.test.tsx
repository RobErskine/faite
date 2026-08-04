// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppHeader } from "./app-header";

/**
 * The header is the only global chrome, and its search field is the sole
 * pointer-driven way into the command palette — ⌘K is the other. These guard
 * that the trigger stays wired and keeps advertising the shortcut, since the
 * palette is otherwise undiscoverable.
 */

afterEach(cleanup);

describe("AppHeader", () => {
  it("opens the palette when the search field is clicked", () => {
    let opened = 0;
    render(<AppHeader onOpenPalette={() => opened++} />);

    fireEvent.click(screen.getByText("Search or run a command…"));

    expect(opened).toBe(1);
  });

  it("advertises the ⌘K shortcut on the search field", () => {
    render(<AppHeader onOpenPalette={() => {}} />);

    const trigger = screen.getByText("Search or run a command…").closest("button");

    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toContain("⌘K");
  });

  it("renders the account avatar", () => {
    render(<AppHeader onOpenPalette={() => {}} />);

    expect(screen.getByLabelText("Account")).toBeTruthy();
    expect(screen.getByText("LU")).toBeTruthy();
  });
});
