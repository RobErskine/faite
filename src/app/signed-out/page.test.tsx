// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SignedOut from "./page";

/**
 * The one thing worth guarding here: on the desktop shell this must NOT offer
 * a route to the bundled `login.html`. The embedded webview cannot hold a
 * session cookie (docs/DESKTOP.md §3.7), so that form can never succeed —
 * sign-in has to leave for the system browser.
 */
const mockIsDesktopShell = vi.fn(() => false);
const mockStartDesktopLogin = vi.fn(async () => {});
vi.mock("@/lib/desktop/bridge", () => ({
  isDesktopShell: () => mockIsDesktopShell(),
  startDesktopLogin: () => mockStartDesktopLogin(),
}));

afterEach(() => {
  cleanup();
  mockIsDesktopShell.mockReturnValue(false);
  mockStartDesktopLogin.mockClear();
});

describe("SignedOut", () => {
  it("offers the system browser on the desktop shell, never an in-app login form", async () => {
    mockIsDesktopShell.mockReturnValue(true);
    render(<SignedOut />);

    fireEvent.click(screen.getByText("Sign in"));

    await waitFor(() => expect(mockStartDesktopLogin).toHaveBeenCalledOnce());
    // A link to /login here would be a form that can never succeed.
    expect(document.querySelector('a[href="/login"]')).toBeNull();
  });

  it("links to the real login page on the web", () => {
    render(<SignedOut />);

    expect(document.querySelector('a[href="/login"]')).toBeTruthy();
    expect(mockStartDesktopLogin).not.toHaveBeenCalled();
  });

  it("still offers the board — signing out is not a gate (ARCHITECTURE §2.13)", () => {
    render(<SignedOut />);

    const escape = document.querySelector('a[href="/board"]');
    expect(escape).toBeTruthy();
    expect(escape?.textContent).toContain("Continue without an account");
  });
});
