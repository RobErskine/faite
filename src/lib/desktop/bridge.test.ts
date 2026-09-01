import { afterEach, describe, expect, it, vi } from "vitest";

const getCurrentMock = vi.fn();
const onOpenUrlMock = vi.fn();
vi.mock("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: (...args: unknown[]) => getCurrentMock(...args),
  onOpenUrl: (...args: unknown[]) => onOpenUrlMock(...args),
}));
const openUrlMock = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...args: unknown[]) => openUrlMock(...args) }));
const hostnameMock = vi.fn();
vi.mock("@tauri-apps/plugin-os", () => ({ hostname: () => hostnameMock() }));
const getVersionMock = vi.fn();
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => getVersionMock() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => Boolean((globalThis as { isTauri?: boolean }).isTauri) }));

const { getShellVersion, isDesktopShell, onDesktopAuthCallback, parseAuthCallbackUrl, startDesktopLogin } =
  await import("./bridge");

afterEach(() => {
  // `isTauri()` reads `globalThis.isTauri` — clean up whatever a test set.
  delete (globalThis as { isTauri?: boolean }).isTauri;
  getCurrentMock.mockReset();
  onOpenUrlMock.mockReset();
  openUrlMock.mockReset();
  hostnameMock.mockReset();
  getVersionMock.mockReset();
});

describe("isDesktopShell", () => {
  it("is false in a plain test/browser environment", () => {
    expect(isDesktopShell()).toBe(false);
  });

  it("is true once Tauri's webview has injected its flag", () => {
    (globalThis as { isTauri?: boolean }).isTauri = true;
    expect(isDesktopShell()).toBe(true);
  });
});

describe("parseAuthCallbackUrl", () => {
  it("extracts the code from a well-formed callback URL", () => {
    expect(parseAuthCallbackUrl("faite://auth-callback?code=abc123")).toBe("abc123");
  });

  it("rejects a different scheme", () => {
    expect(parseAuthCallbackUrl("https://auth-callback?code=abc123")).toBeNull();
  });

  it("rejects a different faite:// host", () => {
    expect(parseAuthCallbackUrl("faite://something-else?code=abc123")).toBeNull();
  });

  it("rejects a missing or empty code", () => {
    expect(parseAuthCallbackUrl("faite://auth-callback")).toBeNull();
    expect(parseAuthCallbackUrl("faite://auth-callback?code=")).toBeNull();
  });

  it("rejects an unparseable URL rather than throwing", () => {
    expect(() => parseAuthCallbackUrl("not a url")).not.toThrow();
    expect(parseAuthCallbackUrl("not a url")).toBeNull();
  });
});

describe("onDesktopAuthCallback", () => {
  it("fires the handler for a cold-start URL from getCurrent()", async () => {
    getCurrentMock.mockResolvedValue(["faite://auth-callback?code=cold"]);
    onOpenUrlMock.mockResolvedValue(() => {});
    const seen: string[] = [];

    await onDesktopAuthCallback((url) => seen.push(url));

    expect(seen).toEqual(["faite://auth-callback?code=cold"]);
  });

  it("fires the handler for every URL onOpenUrl later reports", async () => {
    getCurrentMock.mockResolvedValue(null);
    let liveHandler: ((urls: string[]) => void) | undefined;
    onOpenUrlMock.mockImplementation((handler: (urls: string[]) => void) => {
      liveHandler = handler;
      return Promise.resolve(() => {});
    });
    const seen: string[] = [];

    await onDesktopAuthCallback((url) => seen.push(url));
    liveHandler?.(["faite://auth-callback?code=live"]);

    expect(seen).toEqual(["faite://auth-callback?code=live"]);
  });

  it("does nothing extra when there is no cold-start URL", async () => {
    getCurrentMock.mockResolvedValue(null);
    onOpenUrlMock.mockResolvedValue(() => {});
    const seen: string[] = [];

    await onDesktopAuthCallback((url) => seen.push(url));

    expect(seen).toEqual([]);
  });
});

describe("startDesktopLogin", () => {
  it("folds the OS hostname into callbackURL's own query string (EI-261)", async () => {
    hostnameMock.mockResolvedValue("Robs-MacBook-Pro.local");

    await startDesktopLogin("login");

    expect(openUrlMock).toHaveBeenCalledWith(
      "/login?callbackURL=%2Fdesktop-handoff%3Fdevice%3DRobs-MacBook-Pro.local",
    );
  });

  it("falls back to the unlabeled handoff when hostname() rejects", async () => {
    hostnameMock.mockRejectedValue(new Error("no os:allow-hostname grant"));

    await startDesktopLogin("login");

    expect(openUrlMock).toHaveBeenCalledWith("/login?callbackURL=%2Fdesktop-handoff");
  });

  it("falls back to the unlabeled handoff when hostname() resolves null", async () => {
    hostnameMock.mockResolvedValue(null);

    await startDesktopLogin("signup");

    expect(openUrlMock).toHaveBeenCalledWith("/signup?callbackURL=%2Fdesktop-handoff");
  });
});

describe("getShellVersion", () => {
  it("returns the bundle version inside the desktop shell", async () => {
    (globalThis as { isTauri?: boolean }).isTauri = true;
    getVersionMock.mockResolvedValue("0.4.2");
    await expect(getShellVersion()).resolves.toBe("0.4.2");
  });

  it("returns null in a browser tab without invoking anything", async () => {
    await expect(getShellVersion()).resolves.toBeNull();
    expect(getVersionMock).not.toHaveBeenCalled();
  });

  it("returns null rather than throwing when the invoke fails", async () => {
    // The version check is a nice-to-have; nothing about the board should
    // break because a core command was unavailable.
    (globalThis as { isTauri?: boolean }).isTauri = true;
    getVersionMock.mockRejectedValue(new Error("no ipc"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getShellVersion()).resolves.toBeNull();
  });
});
