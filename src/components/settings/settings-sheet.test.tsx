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

afterEach(cleanup);

function settingsWith(patch: Partial<Settings>): Settings {
  return {
    ownerId: "local-user",
    timezone: "UTC",
    workdaysOnly: false,
    workdays: [1, 2, 3, 4, 5],
    overflowAfterDays: 3,
    visibleDays: 7,
    fontPairing: "hyperlegible",
    theme: "system",
    displayName: "",
    avatarKind: "initials",
    avatarInitials: "",
    avatarEmoji: "",
    avatarImage: "",
    activeTabId: null,
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
});
