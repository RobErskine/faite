// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerReplace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => searchParams,
}));

const session = {
  data: null as { user: { id: string } } | null,
  isPending: false,
};
vi.mock("@/lib/auth-client", () => ({ useSession: () => session }));

const { default: DesktopHandoffPage } = await import("./page");

afterEach(() => {
  cleanup();
  routerReplace.mockClear();
  session.data = null;
  session.isPending = false;
  searchParams = new URLSearchParams();
  vi.unstubAllGlobals();
});

/**
 * The one thing this page adds over the plain handoff (EI-261): a `?device=`
 * query param, set by `bridge.ts`'s `startDesktopLogin()` from the Tauri
 * shell's OS hostname, has to survive both paths through this page — the
 * "already signed in" happy path AND the "redirect to /login first" path —
 * or a device name silently never makes it into the minted key.
 */
describe("DesktopHandoffPage", () => {
  it("sends the device name from the URL in the handoff POST body", async () => {
    session.data = { user: { id: "user-1" } };
    searchParams = new URLSearchParams({ device: "Robs-MacBook-Pro.local" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: "abc" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<DesktopHandoffPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ deviceName: "Robs-MacBook-Pro.local" });
  });

  it("sends a null device name when the URL has none", async () => {
    session.data = { user: { id: "user-1" } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: "abc" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<DesktopHandoffPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ deviceName: null });
  });

  it("preserves the device name through the sign-in redirect when there is no session yet", () => {
    session.data = null;
    searchParams = new URLSearchParams({ device: "Robs-MacBook-Pro.local" });

    act(() => {
      render(<DesktopHandoffPage />);
    });

    expect(routerReplace).toHaveBeenCalledWith(
      "/login?callbackURL=%2Fdesktop-handoff%3Fdevice%3DRobs-MacBook-Pro.local",
    );
  });

  it("redirects to the plain handoff callback when there is no device name and no session", () => {
    session.data = null;

    act(() => {
      render(<DesktopHandoffPage />);
    });

    expect(routerReplace).toHaveBeenCalledWith("/login?callbackURL=%2Fdesktop-handoff");
  });
});
