// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopUpdateBanner } from "./update-banner";
import { CLIENT_OUTDATED_EVENT } from "@/lib/sync/transport";

/**
 * The Tauri half is mocked; everything below it — the fetch, the policy
 * parse, the comparison — runs for real against a stubbed `/api/desktop/version`
 * response, because that path is the actual subject: "server says X, the bar
 * says Y".
 */
const shell = vi.hoisted(() => ({ isDesktop: true, version: "0.1.0", staged: null as string | null }));
const openDownloadPage = vi.hoisted(() => vi.fn((url: string) => Promise.resolve(url)));
const restartForUpdate = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/lib/desktop/bridge", () => ({
  isDesktopShell: () => shell.isDesktop,
  getShellVersion: () => Promise.resolve(shell.isDesktop ? shell.version : null),
  openDownloadPage: (url: string) => openDownloadPage(url),
  // EI-256/EI-258. `getHotAssetStatus` is the one that matters here: the hook
  // reads staged state back from the shell rather than from what it just sent,
  // because a bundle staged in an earlier session counts too.
  getHotAssetStatus: () => Promise.resolve({ active: null, staged: shell.staged, shell: shell.version }),
  prepareHotAssetBundle: () => Promise.resolve(false),
  stageHotAssetBundle: () => Promise.resolve(null),
  restartForUpdate: () => restartForUpdate(),
}));

const DOWNLOAD_URL = "https://myfaite.app/download";

function serverSays(policy: Record<string, string> | null): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      policy
        ? Promise.resolve(new Response(JSON.stringify(policy), { status: 200 }))
        : Promise.resolve(new Response("nope", { status: 500 })),
    ),
  );
}

beforeEach(() => {
  shell.isDesktop = true;
  shell.version = "0.1.0";
  shell.staged = null;
});

afterEach(() => {
  cleanup();
  openDownloadPage.mockClear();
  restartForUpdate.mockClear();
  vi.unstubAllGlobals();
});

describe("DesktopUpdateBanner", () => {
  it("says nothing when the running build is the newest one", async () => {
    serverSays({ latest: "0.1.0", minimum: "0.1.0", downloadUrl: DOWNLOAD_URL });
    render(<DesktopUpdateBanner />);
    // One flush of the check, then still empty.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers a dismissible update when a newer build exists", async () => {
    serverSays({ latest: "0.2.0", minimum: "0.1.0", downloadUrl: DOWNLOAD_URL });
    render(<DesktopUpdateBanner />);

    const update = await screen.findByRole("button", { name: "Update" });
    fireEvent.click(update);
    expect(openDownloadPage).toHaveBeenCalledWith(DOWNLOAD_URL);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("blocks — with no way out but the download — below the minimum", async () => {
    serverSays({ latest: "0.3.0", minimum: "0.2.0", downloadUrl: DOWNLOAD_URL });
    render(<DesktopUpdateBanner />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("too old to sync");
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Get the update" }));
    expect(openDownloadPage).toHaveBeenCalledWith(DOWNLOAD_URL);
  });

  it("stays quiet when the check itself fails", async () => {
    // Offline, or a 500. An unreachable server must never be what puts the
    // app out of service — see `useDesktopUpdate`.
    serverSays(null);
    render(<DesktopUpdateBanner />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ignores a download URL that is not on the app's own origin", async () => {
    serverSays({ latest: "0.9.0", minimum: "0.1.0", downloadUrl: "https://evil.test/dmg" });
    render(<DesktopUpdateBanner />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing at all in a browser tab", async () => {
    shell.isDesktop = false;
    serverSays({ latest: "9.0.0", minimum: "9.0.0", downloadUrl: DOWNLOAD_URL });
    const { container } = render(<DesktopUpdateBanner />);
    expect(container.innerHTML).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("re-checks the moment sync reports this client is obsolete", async () => {
    // The 426 path: the server refuses the client mid-cycle, and the bar
    // appears without waiting out the six-hour poll.
    serverSays({ latest: "0.1.0", minimum: "0.1.0", downloadUrl: DOWNLOAD_URL });
    render(<DesktopUpdateBanner />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    serverSays({ latest: "0.2.0", minimum: "0.2.0", downloadUrl: DOWNLOAD_URL });
    window.dispatchEvent(new CustomEvent(CLIENT_OUTDATED_EVENT));

    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  // ---- EI-258: a staged frontend, on a shell that is perfectly current ----

  it("offers a restart when a bundle is staged and the shell is current", async () => {
    shell.staged = "ecaf9e1389e7";
    serverSays({ latest: "0.1.0", minimum: "0.1.0", downloadUrl: DOWNLOAD_URL });
    render(<DesktopUpdateBanner />);

    expect(await screen.findByRole("button", { name: "Restart" })).toBeTruthy();
    expect(screen.getByText(/Restart Faite to pick it up/)).toBeTruthy();
  });

  it("restarts rather than opening a download page", async () => {
    shell.staged = "ecaf9e1389e7";
    serverSays({ latest: "0.1.0", minimum: "0.1.0", downloadUrl: DOWNLOAD_URL });
    render(<DesktopUpdateBanner />);

    fireEvent.click(await screen.findByRole("button", { name: "Restart" }));

    expect(restartForUpdate).toHaveBeenCalled();
    expect(openDownloadPage).not.toHaveBeenCalled();
  });

  /**
   * The priority rule. A shell below `minimum` cannot sync at all, so telling
   * the user a restart will fix it would be a lie — the staged frontend is
   * real, and irrelevant.
   */
  it("lets a blocked shell win over a staged bundle", async () => {
    shell.staged = "ecaf9e1389e7";
    shell.version = "0.1.0";
    serverSays({ latest: "0.3.0", minimum: "0.2.0", downloadUrl: DOWNLOAD_URL });
    render(<DesktopUpdateBanner />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Get the update" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restart" })).toBeNull();
  });

  it("stays silent when nothing is staged and the shell is current", async () => {
    serverSays({ latest: "0.1.0", minimum: "0.1.0", downloadUrl: DOWNLOAD_URL });
    const { container } = render(<DesktopUpdateBanner />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toBe("");
  });
});
