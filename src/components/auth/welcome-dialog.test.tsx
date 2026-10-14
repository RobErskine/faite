// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomeDialog } from "./welcome-dialog";

vi.mock("@/lib/auth-nudge", () => ({
  useShouldShowAuthNudges: () => true,
}));

vi.mock("@/lib/desktop/bridge", () => ({
  isDesktopShell: () => false,
  startDesktopLogin: async () => {},
}));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("WelcomeDialog (EI-376)", () => {
  it("makes starting the primary action and signing up the secondary one", async () => {
    render(<WelcomeDialog />);

    const start = await screen.findByRole("button", { name: "Start planning" });
    const signUp = screen.getByText("Sign up").closest("a");

    expect(start.className.split(/\s+/)).toContain("bg-primary");
    expect(signUp?.getAttribute("href")).toBe("/signup");
    expect(signUp?.className.split(/\s+/)).toContain("border-border");
    expect(signUp?.className.split(/\s+/)).not.toContain("bg-primary");
  });

  it("closes for good on Start planning", async () => {
    render(<WelcomeDialog />);

    fireEvent.click(await screen.findByRole("button", { name: "Start planning" }));

    expect(localStorage.getItem("faite:welcome-dialog-dismissed")).toBe("1");
  });
});
