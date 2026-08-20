// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteUser = vi.fn(
  async (): Promise<{ error: { status: number; message?: string } | null }> => ({ error: null }),
);
const resetLocalDataForNewOwner = vi.fn(async () => {});
const toastSuccess = vi.fn();
const toastError = vi.fn();
const routerPush = vi.fn();

vi.mock("@/lib/store/adopt-owner", () => ({ resetLocalDataForNewOwner }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "real-user-1", email: "rob@example.com" } },
    isPending: false,
    error: null,
  }),
  authClient: { deleteUser },
}));

const { AccountSection } = await import("./account-section");

beforeEach(() => {
  deleteUser.mockClear();
  deleteUser.mockResolvedValue({ error: null });
  resetLocalDataForNewOwner.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
  routerPush.mockClear();
});
afterEach(cleanup);

describe("AccountSection", () => {
  it("shows the signed-in email", () => {
    render(<AccountSection />);
    expect(screen.getByText("rob@example.com")).toBeTruthy();
  });

  it("keeps the delete action disabled until the typed email matches", () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByRole("button", { name: /^delete account$/i }));

    const confirmButton = screen.getByRole("button", { name: /delete my account/i });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "wrong@example.com" },
    });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "rob@example.com" },
    });
    expect(confirmButton.hasAttribute("disabled")).toBe(false);
  });

  it("is case-insensitive and trims whitespace on the confirmation match", () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByRole("button", { name: /^delete account$/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "  ROB@EXAMPLE.COM  " },
    });

    expect(screen.getByRole("button", { name: /delete my account/i }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("deletes the account, clears local data, and redirects home on success", async () => {
    render(<AccountSection />);
    fireEvent.click(screen.getByRole("button", { name: /^delete account$/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "rob@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /delete my account/i }));

    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith({}));
    await waitFor(() => expect(resetLocalDataForNewOwner).toHaveBeenCalled());
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/"));
    expect(toastSuccess).toHaveBeenCalled();
  });

  /**
   * A failed server-side delete must never clear local data or navigate away —
   * that would tell someone their account is gone when it still exists.
   */
  it("does not clear local data or redirect when the server call fails", async () => {
    deleteUser.mockResolvedValue({ error: { status: 400, message: "Session expired" } });
    render(<AccountSection />);
    fireEvent.click(screen.getByRole("button", { name: /^delete account$/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "rob@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /delete my account/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(resetLocalDataForNewOwner).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("shows a re-authentication hint on a stale-session (400) error", async () => {
    deleteUser.mockResolvedValue({ error: { status: 400, message: "Session expired" } });
    render(<AccountSection />);
    fireEvent.click(screen.getByRole("button", { name: /^delete account$/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "rob@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /delete my account/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][1].description).toMatch(/sign out and back in/i);
  });
});

describe("AccountSection — signed out", () => {
  it("shows nothing destructive when there is no session", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth-client", () => ({
      useSession: () => ({ data: null, isPending: false, error: null }),
      authClient: { deleteUser },
    }));
    const { AccountSection: SignedOutAccountSection } = await import("./account-section");

    render(<SignedOutAccountSection />);
    expect(screen.queryByRole("button", { name: /delete account/i })).toBeNull();
  });
});
