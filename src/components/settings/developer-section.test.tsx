// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resetAccountData = vi.fn(async () => {});
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/store/reset", () => ({ resetAccountData }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "real-user-1" } }, isPending: false, error: null }),
  signOut: vi.fn(),
}));

const { DeveloperSection } = await import("./developer-section");

beforeEach(() => {
  resetAccountData.mockClear();
  resetAccountData.mockResolvedValue(undefined);
  toastSuccess.mockClear();
  toastError.mockClear();
});
afterEach(cleanup);

describe("DeveloperSection", () => {
  /**
   * The guard that matters. This wipes a board irreversibly and sits two
   * clicks from a font picker, so a single stray click must never be enough.
   */
  it("does not reset on the first click — it arms", () => {
    render(<DeveloperSection />);
    fireEvent.click(screen.getByRole("button", { name: /reset board/i }));

    expect(resetAccountData).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /really reset/i })).toBeTruthy();
  });

  it("resets on the second click, passing the signed-in user id", async () => {
    render(<DeveloperSection />);
    fireEvent.click(screen.getByRole("button", { name: /reset board/i }));
    fireEvent.click(screen.getByRole("button", { name: /really reset/i }));

    await waitFor(() => expect(resetAccountData).toHaveBeenCalledWith("real-user-1"));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("can be disarmed without resetting", () => {
    render(<DeveloperSection />);
    fireEvent.click(screen.getByRole("button", { name: /reset board/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(resetAccountData).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /reset board/i })).toBeTruthy();
  });

  /**
   * A failed reset must not report success. Saying "reset" over a server that
   * still holds the old rows sends someone off to debug a schema change
   * against a board that was never cleared — which is the exact confusion
   * this whole ticket exists to remove.
   */
  it("reports a failure as a failure, and stays armed-free", async () => {
    resetAccountData.mockRejectedValue(new Error("500 from /api/sync/reset"));
    render(<DeveloperSection />);
    fireEvent.click(screen.getByRole("button", { name: /reset board/i }));
    fireEvent.click(screen.getByRole("button", { name: /really reset/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError.mock.calls[0][0]).toMatch(/not cleared/i);
  });
});
