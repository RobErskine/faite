// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_OUTDATED_EVENT,
  SyncAuthError,
  SyncHttpError,
  SyncOutdatedError,
  httpTransport,
} from "./transport";
import { SYNC_PROTOCOL_VERSION } from "./wire";

vi.mock("@/lib/desktop/bridge", () => ({
  isDesktopShell: () => false,
  getStoredAuthToken: () => Promise.resolve(null),
}));

function responds(status: number, body: unknown = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

const PUSH = { protocol: SYNC_PROTOCOL_VERSION, entries: [] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the sync HTTP transport's status mapping", () => {
  it("maps 401 to the auth error the engine already knows to stop on", async () => {
    responds(401);
    await expect(httpTransport.push(PUSH)).rejects.toBeInstanceOf(SyncAuthError);
  });

  /**
   * EI-147. Nothing sends this yet — the value is entirely in a shipped
   * client already knowing how to read it years from now, since a desktop
   * bundle is frozen and cannot be taught later. See `SyncOutdatedError`.
   */
  it("maps 426 to an outdated-client error, not a generic HTTP one", async () => {
    responds(426);
    const error = await httpTransport.pull(0, 50).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncOutdatedError);
    // Still a SyncHttpError, so every existing `catch` keeps behaving.
    expect(error).toBeInstanceOf(SyncHttpError);
    expect((error as SyncHttpError).status).toBe(426);
  });

  it("announces the 426 so the update check can run immediately", async () => {
    responds(426);
    const heard = vi.fn();
    window.addEventListener(CLIENT_OUTDATED_EVENT, heard);
    await httpTransport.pull(0, 50).catch(() => {});
    window.removeEventListener(CLIENT_OUTDATED_EVENT, heard);
    expect(heard).toHaveBeenCalledOnce();
  });

  it("leaves every other failure a plain SyncHttpError", async () => {
    responds(500);
    await expect(httpTransport.pull(0, 50)).rejects.toBeInstanceOf(SyncHttpError);
  });
});
