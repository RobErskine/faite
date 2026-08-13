// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSheet } from "./settings-sheet";
import { SETTINGS_SECTIONS } from "./sections";
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

  it("marks 'None' pressed and skips the roll list when overflowAfterDays is 0", () => {
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
    expect(pressed.some((el) => el.textContent?.trim() === "None")).toBe(true);
    expect(screen.queryByText(/rolls to/)).toBeNull();
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
});
