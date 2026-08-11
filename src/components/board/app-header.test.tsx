// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "./app-header";
import type { Settings } from "@/lib/schema";

/**
 * `useSession` normally hits the network via better-auth's react client.
 * Mocked so tests are deterministic and don't depend on a running auth
 * backend — the three `mock*` vars are mutated per-test to switch signed
 * in/out/pending, which also drives `useShouldShowAuthNudges` (auth-nudge.ts)
 * since it wraps this same `useSession`.
 */
let mockSession: { user: { email: string; name?: string | null } } | null = null;
let mockIsPending = false;
let mockError: unknown = null;
const mockSignOut = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: mockSession, isPending: mockIsPending, error: mockError }),
  signOut: () => mockSignOut(),
}));

/**
 * The header is the only global chrome, and its search field is the sole
 * pointer-driven way into the command palette — ⌘K is the other. These guard
 * that the trigger stays wired and keeps advertising the shortcut, since the
 * palette is otherwise undiscoverable.
 */

afterEach(() => {
  cleanup();
  mockSession = null;
  mockIsPending = false;
  mockError = null;
  mockSignOut.mockClear();
});

const noop = () => {};

function settingsWith(patch: Partial<Settings>): Settings {
  return {
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
    updatedAt: "2026-08-03T00:00:00.000Z",
    ...patch,
  };
}

describe("AppHeader", () => {
  it("opens the palette when the search field is clicked", () => {
    let opened = 0;
    render(
      <AppHeader
        onOpenPalette={() => opened++}
        onOpenSettings={noop}
        settings={undefined}
      />,
    );

    fireEvent.click(screen.getByText("Search or run a command…"));

    expect(opened).toBe(1);
  });

  it("advertises the ⌘K shortcut on the search field", () => {
    render(
      <AppHeader onOpenPalette={noop} onOpenSettings={noop} settings={undefined} />,
    );

    const trigger = screen.getByText("Search or run a command…").closest("button");

    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toContain("⌘K");
  });

  it("renders the account avatar with placeholder initials when there is no settings row", () => {
    render(
      <AppHeader onOpenPalette={noop} onOpenSettings={noop} settings={undefined} />,
    );

    expect(screen.getByLabelText("Account")).toBeTruthy();
    expect(screen.getByText("LU")).toBeTruthy();
  });

  it("renders a custom display name and initials", () => {
    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        settings={settingsWith({ displayName: "Rob Erskine" })}
      />,
    );

    fireEvent.click(screen.getByLabelText("Account"));

    expect(screen.getByText("RE")).toBeTruthy();
    expect(screen.getByText("Rob Erskine")).toBeTruthy();
  });

  /**
   * The menu contents only mount once it opens, so rendering the header alone
   * proves nothing about them. Base UI's Menu.GroupLabel throws when it has no
   * Menu.Group ancestor — a crash that reaches the user on first click and
   * that a closed-menu assertion cannot see.
   */
  it("opens the account menu without throwing, offering sign-in when signed out", () => {
    render(
      <AppHeader onOpenPalette={noop} onOpenSettings={noop} settings={undefined} />,
    );

    fireEvent.click(screen.getByLabelText("Account"));

    expect(screen.getByText("Local User")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Sign in")).toBeTruthy();
  });

  it("shows the account email and a working sign-out when signed in", async () => {
    mockSession = { user: { email: "rob@myfaite.app", name: "Rob Erskine" } };
    render(
      <AppHeader onOpenPalette={noop} onOpenSettings={noop} settings={undefined} />,
    );

    fireEvent.click(screen.getByLabelText("Account"));

    expect(screen.getByText("rob@myfaite.app")).toBeTruthy();
    fireEvent.click(screen.getByText("Log out"));

    expect(mockSignOut).toHaveBeenCalledOnce();
  });

  it("shows the account name and its initials instead of the placeholder", () => {
    mockSession = { user: { email: "rob@myfaite.app", name: "Rob Erskine" } };
    render(
      <AppHeader onOpenPalette={noop} onOpenSettings={noop} settings={undefined} />,
    );

    // Initials render on the closed trigger; the name needs the menu open.
    expect(screen.getByText("RE")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Account"));
    expect(screen.getByText("Rob Erskine")).toBeTruthy();
    expect(screen.queryByText("Local User")).toBeNull();
  });

  it("falls back to the email when the account has no name, without repeating it", () => {
    mockSession = { user: { email: "rob@myfaite.app", name: null } };
    render(
      <AppHeader onOpenPalette={noop} onOpenSettings={noop} settings={undefined} />,
    );

    fireEvent.click(screen.getByLabelText("Account"));

    // Exactly once: as the name. The secondary email line suppresses itself
    // rather than printing the same string twice.
    expect(screen.getAllByText("rob@myfaite.app")).toHaveLength(1);
  });

  it("opens settings from the account menu", () => {
    let opened = 0;
    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={() => opened++}
        settings={undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText("Account"));
    fireEvent.click(screen.getByText("Settings"));

    expect(opened).toBe(1);
  });

  it("links the wordmark to the board", () => {
    render(
      <AppHeader onOpenPalette={noop} onOpenSettings={noop} settings={undefined} />,
    );

    expect(screen.getByText("Faite").closest("a")?.getAttribute("href")).toBe(
      "/board",
    );
  });

  it("shows a Sign up CTA next to the avatar when signed out", () => {
    render(
      <AppHeader onOpenPalette={noop} onOpenSettings={noop} settings={undefined} />,
    );

    expect(screen.getByText("Sign up").closest("a")?.getAttribute("href")).toBe(
      "/signup",
    );
  });

  it("hides the Sign up CTA once signed in", () => {
    mockSession = { user: { email: "rob@myfaite.app" } };
    render(
      <AppHeader onOpenPalette={noop} onOpenSettings={noop} settings={undefined} />,
    );

    expect(screen.queryByText("Sign up")).toBeNull();
  });

  it("hides the Sign up CTA while the session check is still pending", () => {
    mockIsPending = true;
    render(
      <AppHeader onOpenPalette={noop} onOpenSettings={noop} settings={undefined} />,
    );

    expect(screen.queryByText("Sign up")).toBeNull();
  });
});
