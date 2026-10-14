// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissBanner,
  dismissWelcomeDialog,
  isBannerDismissed,
  isWelcomeDialogDismissed,
} from "./onboarding";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signed-out banner dismissal (EI-376)", () => {
  it("is not dismissed on a fresh device", () => {
    expect(isBannerDismissed()).toBe(false);
  });

  it("persists on this device, not just for the session", () => {
    dismissBanner();

    expect(localStorage.getItem("faite:banner-dismissed")).toBe("1");
    // The old per-session tier is what made it come back every visit.
    expect(sessionStorage.getItem("faite:banner-dismissed")).toBeNull();
  });

  it("stays dismissed after the session ends", () => {
    dismissBanner();
    // A new visit: sessionStorage is gone, localStorage is not.
    sessionStorage.clear();

    expect(isBannerDismissed()).toBe(true);
  });

  it("ignores a dismissal left in sessionStorage by an older build", () => {
    sessionStorage.setItem("faite:banner-dismissed", "1");

    expect(isBannerDismissed()).toBe(false);
  });

  it("degrades to 'not dismissed' when storage throws", () => {
    // Privacy modes throw on any storage access.
    const refuse = () => {
      throw new Error("SecurityError");
    };
    vi.stubGlobal("localStorage", { getItem: refuse, setItem: refuse });

    expect(() => dismissBanner()).not.toThrow();
    expect(isBannerDismissed()).toBe(false);
  });
});

describe("welcome dialog dismissal", () => {
  it("persists on this device", () => {
    expect(isWelcomeDialogDismissed()).toBe(false);

    dismissWelcomeDialog();
    sessionStorage.clear();

    expect(isWelcomeDialogDismissed()).toBe(true);
  });

  it("is independent of the banner's flag", () => {
    dismissBanner();

    expect(isWelcomeDialogDismissed()).toBe(false);
  });
});
