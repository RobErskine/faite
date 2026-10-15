// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSheet } from "./settings-sheet";
import { SETTINGS_SECTIONS } from "./sections";
import { ROOT_COMMANDS, type PaletteCommandCtx } from "@/lib/command-registry";
import { FONT_PAIRINGS } from "@/lib/fonts";
import type { Settings } from "@/lib/schema";

/**
 * ProfileSection reads the session (via useIdentity) to fall back to the
 * account's name/email when no local display name is set. Mocked signed-out so
 * these tests stay about the settings UI and don't reach the network.
 */
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: null, isPending: false, error: null }),
  signOut: vi.fn(),
}));

/**
 * happy-dom serves pages from `localhost`, so `isLocalDev()` is true here by
 * accident — which would let the dev-only section render in every test and
 * quietly prove nothing about the gate. Mocked so both states are asserted
 * deliberately.
 */
const dev = vi.hoisted(() => ({ isLocal: true }));
vi.mock("@/lib/dev", () => ({ isLocalDev: () => dev.isLocal }));

afterEach(() => {
  dev.isLocal = true;
  cleanup();
});

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

describe("SettingsSheet", () => {
  it("renders nothing when closed", () => {
    render(
      <SettingsSheet open={false} onOpenChange={() => {}} settings={undefined} />,
    );

    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });

  it("mounts open without throwing, with a nav entry for every section", () => {
    render(
      <SettingsSheet open onOpenChange={() => {}} settings={undefined} />,
    );

    for (const section of SETTINGS_SECTIONS) {
      expect(screen.getByText(section.label)).toBeTruthy();
    }
  });

  it("shows dev-only sections on localhost", () => {
    render(<SettingsSheet open onOpenChange={() => {}} settings={undefined} />);

    expect(screen.getByText("Developer")).toBeTruthy();
  });

  /**
   * The gate. A destructive "wipe this board" button reaching a deployed
   * origin is the failure being ruled out — so this asserts on the section's
   * `devOnly` flag rather than the literal string "Developer", and will keep
   * covering any future dev-only section without being updated.
   */
  it("hides every dev-only section anywhere that is not localhost", () => {
    dev.isLocal = false;
    render(<SettingsSheet open onOpenChange={() => {}} settings={undefined} />);

    const devSections = SETTINGS_SECTIONS.filter((section) => section.devOnly);
    expect(devSections.length).toBeGreaterThan(0);
    for (const section of devSections) {
      expect(screen.queryByText(section.label)).toBeNull();
    }
    // The ordinary sections are untouched.
    expect(screen.getByText("Profile")).toBeTruthy();
    expect(screen.getByText("Design")).toBeTruthy();
  });

  it("shows the Profile panel by default", () => {
    render(
      <SettingsSheet open onOpenChange={() => {}} settings={undefined} />,
    );

    expect(screen.getByText("Display name")).toBeTruthy();
  });

  it("offers every font pairing in the Design panel, previewed in its own pairing", () => {
    render(
      <SettingsSheet open onOpenChange={() => {}} settings={undefined} />,
    );

    fireEvent.click(screen.getByText("Design"));

    for (const pairing of FONT_PAIRINGS) {
      const label = screen.getByText(pairing.label);
      expect(label.closest(`[data-font="${pairing.id}"]`)).toBeTruthy();
    }
  });

  it("offers all three appearance modes and marks the current one", () => {
    render(
      <SettingsSheet
        open
        onOpenChange={() => {}}
        settings={settingsWith({ theme: "dark" })}
      />,
    );

    fireEvent.click(screen.getByText("Design"));

    const pressed = screen
      .getAllByRole("button")
      .filter((el) => el.getAttribute("aria-pressed") === "true");
    const darkButtons = pressed.filter((el) => el.textContent?.includes("Dark"));
    expect(darkButtons.length).toBe(1);
  });

  it("falls back to System for a settings row with no theme", () => {
    const legacyRow = settingsWith({}) as Settings;
    // @ts-expect-error simulating a row written before `theme` existed
    delete legacyRow.theme;

    render(<SettingsSheet open onOpenChange={() => {}} settings={legacyRow} />);
    fireEvent.click(screen.getByText("Design"));

    const systemButton = screen
      .getAllByRole("button")
      .find((el) => el.textContent?.trim() === "System");
    expect(systemButton?.getAttribute("aria-pressed")).toBe("true");
  });

  it("falls back to initials for a settings row with no avatarKind", () => {
    const legacyRow = settingsWith({}) as Settings;
    // @ts-expect-error simulating a row written before `avatarKind` existed
    delete legacyRow.avatarKind;

    render(<SettingsSheet open onOpenChange={() => {}} settings={legacyRow} />);

    expect(screen.getByText("LU")).toBeTruthy();
  });

  it("marks the current rolls preset and describes the loop in the Faite Loop panel", () => {
    render(
      <SettingsSheet
        open
        onOpenChange={() => {}}
        settings={settingsWith({ overflowAfterDays: 3, timezone: "UTC" })}
      />,
    );

    fireEvent.click(screen.getByText("Faite Loop"));

    const pressed = screen
      .getAllByRole("button")
      .filter((el) => el.getAttribute("aria-pressed") === "true");
    expect(pressed.some((el) => el.textContent?.trim() === "3")).toBe(true);
    expect(screen.getByText(/rolls to/)).toBeTruthy();
    expect(screen.getByText(/Overflow on/)).toBeTruthy();
  });

  it("marks '0 · next day' pressed and skips the roll list when overflowAfterDays is 0", () => {
    render(
      <SettingsSheet
        open
        onOpenChange={() => {}}
        settings={settingsWith({ overflowAfterDays: 0, timezone: "UTC" })}
      />,
    );

    fireEvent.click(screen.getByText("Faite Loop"));

    const pressed = screen
      .getAllByRole("button")
      .filter((el) => el.getAttribute("aria-pressed") === "true");
    expect(pressed.some((el) => el.textContent?.trim() === "0 · next day")).toBe(true);
    expect(screen.queryByText(/rolls to/)).toBeNull();
  });

  it("names the 0 preset for what it does, never 'None' (EI-383)", () => {
    render(
      <SettingsSheet
        open
        onOpenChange={() => {}}
        settings={settingsWith({ overflowAfterDays: 3, timezone: "UTC" })}
      />,
    );

    fireEvent.click(screen.getByText("Faite Loop"));

    const rolls = screen.getByRole("group", { name: "Rolls before Overflow" });
    // The visible text IS the accessible name — no aria-label to drift from it.
    const zero = within(rolls).getByRole("button", { name: "0 · next day" });
    expect(zero.getAttribute("aria-label")).toBeNull();
    expect(within(rolls).queryByRole("button", { name: "None" })).toBeNull();
  });

  it("says when Overdrive shows instead of 'Entry threshold' (EI-383)", () => {
    render(<SettingsSheet open onOpenChange={() => {}} settings={settingsWith({})} />);

    fireEvent.click(screen.getByText("Faite Loop"));

    expect(screen.queryByText("Entry threshold")).toBeNull();
    expect(screen.getByRole("group", { name: "When to show Overdrive" })).toBeTruthy();
  });

  it("reflects workdaysOnly as the Faite Loop switch state", () => {
    render(
      <SettingsSheet
        open
        onOpenChange={() => {}}
        settings={settingsWith({ workdaysOnly: true })}
      />,
    );

    fireEvent.click(screen.getByText("Faite Loop"));

    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("marks the current entry-threshold and auto-confirm presets in the Overdrive panel (EI-103)", () => {
    render(
      <SettingsSheet
        open
        onOpenChange={() => {}}
        settings={settingsWith({ overdriveMinTodos: 8, overdriveAutoConfirmMs: 3000 })}
      />,
    );

    fireEvent.click(screen.getByText("Faite Loop"));

    const pressed = screen
      .getAllByRole("button")
      .filter((el) => el.getAttribute("aria-pressed") === "true")
      .map((el) => el.textContent?.trim());
    expect(pressed).toContain("8");
    expect(pressed).toContain("3s");
  });

  it("falls back to the OVERDRIVE_MIN_TODOS default and auto-confirm off with no settings row at all", () => {
    render(<SettingsSheet open onOpenChange={() => {}} settings={undefined} />);

    fireEvent.click(screen.getByText("Faite Loop"));

    const pressed = screen
      .getAllByRole("button")
      .filter((el) => el.getAttribute("aria-pressed") === "true")
      .map((el) => el.textContent?.trim());
    expect(pressed).toContain("5");
    expect(pressed).toContain("Off");
  });

  describe("opening on a section (EI-386)", () => {
    const selectedTab = () =>
      screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")
        ?.textContent;

    it("opens on initialSection, and on it again each time it reopens", () => {
      const { rerender } = render(
        <SettingsSheet open onOpenChange={() => {}} settings={undefined} initialSection="loop" />,
      );
      expect(selectedTab()).toBe("Faite Loop");

      rerender(
        <SettingsSheet open={false} onOpenChange={() => {}} settings={undefined} initialSection="design" />,
      );
      rerender(
        <SettingsSheet open onOpenChange={() => {}} settings={undefined} initialSection="design" />,
      );
      expect(selectedTab()).toBe("Design");
    });

    it("falls back to the first section for an id it does not show", () => {
      dev.isLocal = false;
      render(
        <SettingsSheet open onOpenChange={() => {}} settings={undefined} initialSection="developer" />,
      );
      expect(selectedTab()).toBe(SETTINGS_SECTIONS[0].label);
    });

    /** ⌘K names sections by id (`command-registry.ts`); a renamed id here
     * would quietly open the first section instead. */
    it("knows every section a palette command opens", () => {
      const asked: (string | undefined)[] = [];
      const ctx = {
        openSettings: (section?: string) => asked.push(section),
        close: () => {},
      } as unknown as PaletteCommandCtx;
      for (const command of ROOT_COMMANDS.filter((c) => c.id.startsWith("manage-settings"))) {
        void command.run(ctx);
      }
      const ids = asked.filter((id): id is string => id !== undefined);
      expect(ids).toEqual(["loop", "design"]);
      const known = new Set(SETTINGS_SECTIONS.map((section) => section.id));
      for (const id of ids) expect(known.has(id)).toBe(true);
    });
  });
});
