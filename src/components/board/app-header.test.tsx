// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "./app-header";
import { BOUND_OWNER_KEY } from "@/lib/store/owner";
import type { Settings } from "@/lib/schema";

/**
 * `useSession` normally hits the network via better-auth's react client.
 * Mocked so tests are deterministic and don't depend on a running auth
 * backend — the three `mock*` vars are mutated per-test to switch signed
 * in/out/pending, which also drives `useShouldShowAuthNudges` (auth-nudge.ts)
 * since it wraps this same `useSession`.
 */
let mockSession: { user: { id: string; email: string; name?: string | null } } | null = null;
let mockIsPending = false;
let mockError: unknown = null;
const mockSignOut = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: mockSession, isPending: mockIsPending, error: mockError }),
  signOut: () => mockSignOut(),
}));

/**
 * Sign-out now flushes the outbox and erases the device. Both are mocked
 * here so this file needs neither `fake-indexeddb` nor a sync transport —
 * `flushOutbox` returning a plain number is what makes that possible.
 * `clear-device.test.ts` covers what the wipe actually does.
 */
const mockFlushOutbox = vi.fn(async () => 0);
const mockClearDeviceData = vi.fn(async () => {});
vi.mock("@/components/sync/sync-provider", () => ({
  flushOutbox: () => mockFlushOutbox(),
}));
vi.mock("@/lib/store/clear-device", () => ({
  clearDeviceData: () => mockClearDeviceData(),
}));

const USER_ID = "real-user-1";

/**
 * The header is the only global chrome, and its search field is the sole
 * pointer-driven way into the command palette — ⌘K is the other. These guard
 * that the trigger stays wired and keeps advertising the shortcut, since the
 * palette is otherwise undiscoverable.
 */

/**
 * `window.location.replace` is what carries the user off the board, so every
 * signed-in test needs it stubbed or happy-dom would try to navigate. Spying
 * on it works under happy-dom — `api-origin.test.ts` relies on the same.
 */
let mockReplace: ReturnType<typeof vi.fn>;
let mockReload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  mockReplace = vi.fn();
  mockReload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, replace: mockReplace, reload: mockReload },
  });
});

afterEach(() => {
  cleanup();
  mockSession = null;
  mockIsPending = false;
  mockError = null;
  // `mockReset`, not `mockClear` — the ordering test installs implementations
  // that push into an array scoped to that test, and `mockClear` would leave
  // them in place for every test after it.
  mockSignOut.mockReset();
  mockFlushOutbox.mockReset();
  mockFlushOutbox.mockResolvedValue(0);
  mockClearDeviceData.mockReset();
  mockClearDeviceData.mockResolvedValue(undefined);
  localStorage.clear();
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
    visibleActivityKinds: ["created", "scheduled", "unscheduled", "moved", "done", "dropped", "reopened", "edited", "deleted", "rolledOver", "overflowed"],
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
    overdriveMinTodos: 5,
    overdriveAutoConfirmMs: 0,
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
        onOpenHelp={noop}
        settings={undefined}
      />,
    );

    fireEvent.click(screen.getByText("Search or run a command…"));

    expect(opened).toBe(1);
  });

  it("advertises the ⌘K shortcut on the search field", () => {
    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
        settings={undefined}
      />,
    );

    const trigger = screen.getByText("Search or run a command…").closest("button");

    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toContain("⌘K");
  });

  it("renders the account avatar with placeholder initials when there is no settings row", () => {
    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
        settings={undefined}
      />,
    );

    expect(screen.getByLabelText("Account")).toBeTruthy();
    expect(screen.getByText("LU")).toBeTruthy();
  });

  it("renders a custom display name and initials", () => {
    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
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
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
        settings={undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText("Account"));

    expect(screen.getByText("Local User")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Sign in")).toBeTruthy();
  });

  it("shows the account email and a working sign-out when signed in", async () => {
    mockSession = { user: { id: USER_ID, email: "rob@myfaite.app", name: "Rob Erskine" } };
    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
        settings={undefined}
      />,
    );

    localStorage.setItem(BOUND_OWNER_KEY, USER_ID);
    fireEvent.click(screen.getByLabelText("Account"));

    expect(screen.getByText("rob@myfaite.app")).toBeTruthy();
    fireEvent.click(screen.getByText("Log out"));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledOnce());
  });

  it("flushes, signs out, erases the device, then leaves the board — in that order", async () => {
    mockSession = { user: { id: USER_ID, email: "rob@myfaite.app" } };
    localStorage.setItem(BOUND_OWNER_KEY, USER_ID);

    const order: string[] = [];
    mockFlushOutbox.mockImplementation(async () => {
      order.push("flush");
      return 0;
    });
    mockSignOut.mockImplementation(() => {
      order.push("signOut");
    });
    mockClearDeviceData.mockImplementation(async () => {
      order.push("clear");
    });
    mockReplace.mockImplementation(() => {
      order.push("navigate");
    });

    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
        settings={undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText("Account"));
    fireEvent.click(screen.getByText("Log out"));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"));

    // The flush must beat the sign-out (the cookie is still valid), and the
    // sign-out must beat the wipe — clearing while the session is live would
    // let the still-mounted engine re-pull the whole board on its next tick.
    expect(order).toEqual(["flush", "signOut", "clear", "navigate"]);
  });

  it("asks before erasing unsynced work, and erases nothing until confirmed", async () => {
    mockSession = { user: { id: USER_ID, email: "rob@myfaite.app" } };
    localStorage.setItem(BOUND_OWNER_KEY, USER_ID);
    mockFlushOutbox.mockResolvedValue(3);

    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
        settings={undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText("Account"));
    fireEvent.click(screen.getByText("Log out"));

    await waitFor(() =>
      expect(screen.getByText("Sign out with unsaved changes?")).toBeTruthy(),
    );
    expect(screen.getByText(/3 changes haven't/)).toBeTruthy();

    // Nothing destructive may have happened yet — staying signed in is the
    // only state those 3 changes can still be saved from.
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockClearDeviceData).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Sign out and erase"));

    await waitFor(() => expect(mockClearDeviceData).toHaveBeenCalledOnce());
    expect(mockSignOut).toHaveBeenCalledOnce();
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("signs out WITHOUT erasing when the board belongs to a different account", async () => {
    mockSession = { user: { id: USER_ID, email: "rob@myfaite.app" } };
    // The state SessionProvider's "switch accounts?" dialog puts us in:
    // this device's board is user A's, but user B is momentarily signed in.
    localStorage.setItem(BOUND_OWNER_KEY, "someone-else");

    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
        settings={undefined}
      />,
    );
    fireEvent.click(screen.getByLabelText("Account"));
    fireEvent.click(screen.getByText("Log out"));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledOnce());

    // Erasing here would destroy A's board to fix B's mistake, and flushing
    // would push A's rows into B's Durable Object.
    expect(mockFlushOutbox).not.toHaveBeenCalled();
    expect(mockClearDeviceData).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows the account name and its initials instead of the placeholder", () => {
    mockSession = { user: { id: USER_ID, email: "rob@myfaite.app", name: "Rob Erskine" } };
    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
        settings={undefined}
      />,
    );

    // Initials render on the closed trigger; the name needs the menu open.
    expect(screen.getByText("RE")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Account"));
    expect(screen.getByText("Rob Erskine")).toBeTruthy();
    expect(screen.queryByText("Local User")).toBeNull();
  });

  it("falls back to the email when the account has no name, without repeating it", () => {
    mockSession = { user: { id: USER_ID, email: "rob@myfaite.app", name: null } };
    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
        settings={undefined}
      />,
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
        onOpenHelp={noop}
        settings={undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText("Account"));
    fireEvent.click(screen.getByText("Settings"));

    expect(opened).toBe(1);
  });

  it("opens the help sheet from the header's help icon", () => {
    let opened = 0;
    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={() => opened++}
        settings={undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText("Keyboard shortcuts"));

    expect(opened).toBe(1);
  });

  it("links the wordmark to the board", () => {
    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
        settings={undefined}
      />,
    );

    expect(screen.getByText("Faite").closest("a")?.getAttribute("href")).toBe(
      "/board",
    );
  });

  it("shows a Sign up CTA next to the avatar when signed out", () => {
    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
        settings={undefined}
      />,
    );

    expect(screen.getByText("Sign up").closest("a")?.getAttribute("href")).toBe(
      "/signup",
    );
  });

  it("hides the Sign up CTA once signed in", () => {
    mockSession = { user: { id: USER_ID, email: "rob@myfaite.app" } };
    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
        settings={undefined}
      />,
    );

    expect(screen.queryByText("Sign up")).toBeNull();
  });

  it("hides the Sign up CTA while the session check is still pending", () => {
    mockIsPending = true;
    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
        settings={undefined}
      />,
    );

    expect(screen.queryByText("Sign up")).toBeNull();
  });
});
