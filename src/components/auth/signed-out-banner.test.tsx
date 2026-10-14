// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignedOutBanner } from "./signed-out-banner";

let mockShowNudges = true;
vi.mock("@/lib/auth-nudge", () => ({
  useShouldShowAuthNudges: () => mockShowNudges,
}));

let mockDesktop = false;
const mockStartDesktopLogin = vi.fn<(page: "login" | "signup") => Promise<void>>(async () => {});
vi.mock("@/lib/desktop/bridge", () => ({
  isDesktopShell: () => mockDesktop,
  startDesktopLogin: (page: "login" | "signup") => mockStartDesktopLogin(page),
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mockShowNudges = true;
  mockDesktop = false;
  mockStartDesktopLogin.mockClear();
});

afterEach(() => {
  cleanup();
});

/** The banner's root: the row that holds the copy and the dismiss button. */
function bannerRoot(): HTMLElement {
  const root = screen.getByLabelText("Dismiss").parentElement;
  if (!root) throw new Error("banner root not found");
  return root;
}

describe("SignedOutBanner (EI-376)", () => {
  it("uses the info tone, not the warning tone", () => {
    render(<SignedOutBanner hasUserData />);

    const classes = bannerRoot().className.split(/\s+/);
    expect(classes).toContain("bg-info-soft");
    expect(classes).toContain("text-info-foreground");
    expect(classes).not.toContain("bg-warning-soft");
    expect(classes).not.toContain("text-warning-foreground");
  });

  it("says the data is on this device, and links to sign up", () => {
    render(<SignedOutBanner hasUserData />);

    expect(bannerRoot().textContent).toContain("on this device");
    expect(screen.getByText("Sign up").closest("a")?.getAttribute("href")).toBe("/signup");
  });

  it("gives the Sign up link the shared focus ring and a 24px hit area", () => {
    render(<SignedOutBanner hasUserData />);

    const classes = screen.getByText("Sign up").className.split(/\s+/);
    expect(classes).toContain("focus-ring");
    // `::after` inset 6px above and below a 12–14px line: ≥24px tall.
    expect(classes).toContain("relative");
    expect(classes).toContain("after:absolute");
    expect(classes).toContain("after:-inset-y-1.5");
  });

  it("stays dismissed on this device across visits", () => {
    const first = render(<SignedOutBanner hasUserData />);
    fireEvent.click(screen.getByLabelText("Dismiss"));

    expect(screen.queryByText("Sign up")).toBeNull();
    expect(localStorage.getItem("faite:banner-dismissed")).toBe("1");

    // Next visit: a new session, a fresh mount.
    first.unmount();
    sessionStorage.clear();
    render(<SignedOutBanner hasUserData />);

    expect(screen.queryByText("Sign up")).toBeNull();
  });

  it("does not show on an empty board", () => {
    render(<SignedOutBanner hasUserData={false} />);

    expect(screen.queryByText("Sign up")).toBeNull();
  });

  it("does not show when nudges are off (signed in, or checking)", () => {
    mockShowNudges = false;
    render(<SignedOutBanner hasUserData />);

    expect(screen.queryByText("Sign up")).toBeNull();
  });

  it("opens the system browser to sign up in the desktop app", () => {
    mockDesktop = true;
    render(<SignedOutBanner hasUserData />);

    const button = screen.getByRole("button", { name: "Sign up" });
    expect(button.className.split(/\s+/)).toContain("focus-ring");
    fireEvent.click(button);

    expect(mockStartDesktopLogin).toHaveBeenCalledWith("signup");
  });
});
