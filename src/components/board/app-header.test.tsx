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

  /*
    The trigger's initials are CSS-generated content, not text (EI-391): a
    text "LU" inside an "Account" button is a Label-in-Name mismatch to
    Lighthouse even when hidden from assistive tech. So they are read off the
    attribute the CSS draws, not found by text.
  */
  const avatarGlyph = () =>
    screen.getByLabelText("Account").querySelector<HTMLElement>("[data-glyph]")?.dataset.glyph;

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
    expect(avatarGlyph()).toBe("LU");
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

    expect(avatarGlyph()).toBe("RE");
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

  it("lands an app-shell build on the signed-out screen, not back on the board", async () => {
    // Tauri and Capacitor. `/` is a redirect stub to /board there and the
    // windows open on board.html directly, so both `/` and a plain reload
    // would put the user straight back on a board.
    vi.stubEnv("NEXT_PUBLIC_APP_SHELL", "1");
    mockSession = { user: { id: USER_ID, email: "rob@myfaite.app" } };
    localStorage.setItem(BOUND_OWNER_KEY, USER_ID);

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

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("signed-out.html"));
    expect(mockReload).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
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
    expect(avatarGlyph()).toBe("RE");
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

  it("renders the Sign up CTA as an outline button, never the filled default (EI-376)", () => {
    render(
      <AppHeader
        onOpenPalette={noop}
        onOpenSettings={noop}
        onOpenHelp={noop}
        settings={undefined}
      />,
    );

    const cta = screen.getByText("Sign up").closest("a");
    const classes = cta?.className.split(/\s+/) ?? [];
    // The outline variant's border, and none of the filled default's fill.
    expect(classes).toContain("border-border");
    expect(classes).toContain("bg-background");
    expect(classes).not.toContain("bg-primary");
    expect(classes).not.toContain("text-primary-foreground");
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

/**
 * EI-388. The wordmark measured 31×20 — under 24 even with a mouse. A
 * `py-0.5 -my-0.5` pair makes it 24 tall without moving it, and a coarse-only
 * `::after` takes it to 47×44. Classes, since happy-dom has no layout.
 */
describe("the wordmark's target (EI-388)", () => {
  it("is 24px for a mouse and extends to 44px on touch", () => {
    render(
      <AppHeader onOpenPalette={noop} onOpenSettings={noop} onOpenHelp={noop} settings={undefined} />,
    );
    const cls = screen.getByRole("link", { name: "Faite" }).className.split(/\s+/);
    expect(cls).toContain("py-0.5");
    expect(cls).toContain("-my-0.5");
    expect(cls).toContain("relative");
    expect(cls).toContain("pointer-coarse:after:absolute");
    expect(cls).toContain("pointer-coarse:after:-inset-x-2");
    expect(cls).toContain("pointer-coarse:after:-inset-y-2.5");
    expect(cls).toContain("pointer-coarse:after:content-['']");
  });
});

/**
 * EI-392. Keyboard shortcuts measured 42 wide at 390×844: its 6px extender
 * and the avatar's 8px one asked for 14px of a 12px `gap-3`, and the later
 * element wins a tap in an overlap. The avatar now takes 6px left (meeting
 * the help button's extender exactly) and 10px right, into `px-4`.
 */
describe("header touch targets do not overlap (EI-392)", () => {
  it("gives the avatar a lopsided extender that stops where the help button's starts", () => {
    render(
      <AppHeader onOpenPalette={noop} onOpenSettings={noop} onOpenHelp={noop} settings={undefined} />,
    );
    const avatar = screen.getByRole("button", { name: "Account" }).className.split(/\s+/);
    expect(avatar).toContain("pointer-coarse:after:-left-1.5");
    expect(avatar).toContain("pointer-coarse:after:-right-2.5");
    expect(avatar).toContain("pointer-coarse:after:-inset-y-2");
    expect(avatar).not.toContain("pointer-coarse:after:-inset-2");
    // 6px + 6px is the header's whole 12px gap, and not a pixel more.
    const help = screen.getByRole("button", { name: "Keyboard shortcuts" }).className.split(/\s+/);
    expect(help).toContain("pointer-coarse:after:-inset-1.5");
    expect(screen.getByRole("banner").className).toContain("gap-3");
  });
});
