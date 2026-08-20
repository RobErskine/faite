import { afterEach, describe, expect, it, vi } from "vitest";

const getCurrentMock = vi.fn();
const onOpenUrlMock = vi.fn();
vi.mock("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: (...args: unknown[]) => getCurrentMock(...args),
  onOpenUrl: (...args: unknown[]) => onOpenUrlMock(...args),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => Boolean((globalThis as { isTauri?: boolean }).isTauri) }));

const { isDesktopShell, onDesktopAuthCallback, parseAuthCallbackUrl } = await import("./bridge");

afterEach(() => {
  // `isTauri()` reads `globalThis.isTauri` — clean up whatever a test set.
  delete (globalThis as { isTauri?: boolean }).isTauri;
  getCurrentMock.mockReset();
  onOpenUrlMock.mockReset();
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
