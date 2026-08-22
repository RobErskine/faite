// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeysSection } from "./api-keys-section";

const { list, create, del, toastSuccess, toastError, session } = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  del: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  session: {
    data: null as { user: { id: string } } | null,
    isPending: false,
    error: null as { message: string } | null,
  },
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => session,
  authClient: {
    apiKey: {
      list: (...args: unknown[]) => list(...args),
      create: (...args: unknown[]) => create(...args),
      delete: (...args: unknown[]) => del(...args),
    },
  },
}));

const KEY_ROW = {
  id: "key-1",
  name: "Pointer",
  start: "abcd",
  prefix: "faite_",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  expiresAt: null,
  permissions: { api: ["read"] },
};

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

beforeEach(() => {
  session.data = { user: { id: "user-1" } };
  session.isPending = false;
  session.error = null;
  setOnline(true);
  list.mockResolvedValue({ data: { apiKeys: [KEY_ROW], total: 1 }, error: null });
  create.mockResolvedValue({ data: { key: "faite_the-raw-secret-value" }, error: null });
  del.mockResolvedValue({ data: { success: true }, error: null });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => {});
}

describe("ApiKeysSection", () => {
  it("prompts sign-in when signed out", () => {
    session.data = null;
    render(<ApiKeysSection />);
    expect(screen.getByText(/sign in to create and manage/i)).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
  });

  it("shows an offline message and never calls the network while offline", async () => {
    setOnline(false);
    render(<ApiKeysSection />);
    await flush();
    expect(screen.getByText(/require a network connection/i)).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
  });

  it("loads and lists existing keys, with a read-only scope summary", async () => {
    render(<ApiKeysSection />);
    await flush();
    expect(screen.getByText("Pointer")).toBeTruthy();
    expect(screen.getByText("Read-only")).toBeTruthy();
  });

  it("shows the empty state when there are no keys", async () => {
    list.mockResolvedValue({ data: { apiKeys: [], total: 0 }, error: null });
    render(<ApiKeysSection />);
    await flush();
    expect(screen.getByText("No API keys yet.")).toBeTruthy();
  });

  it("shows a load error without crashing on a failed list call", async () => {
    list.mockResolvedValue({ data: null, error: { message: "network" } });
    render(<ApiKeysSection />);
    await flush();
    expect(screen.getByText(/couldn't load your keys/i)).toBeTruthy();
  });

  it("creates a key and reveals the raw secret exactly once, disabling Done until copied", async () => {
    render(<ApiKeysSection />);
    await flush();

    fireEvent.change(screen.getByPlaceholderText(/Pointer, my script/i), {
      target: { value: "my new key" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
    });

    expect(create).toHaveBeenCalledWith({ name: "my new key" });
    expect(screen.getByDisplayValue("faite_the-raw-secret-value")).toBeTruthy();

    const doneButton = screen.getByRole("button", { name: "Copy it first" }) as HTMLButtonElement;
    expect(doneButton.disabled).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy key" }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("faite_the-raw-secret-value");
    await waitFor(() => {
      const done = screen.getByRole("button", { name: "Done" }) as HTMLButtonElement;
      expect(done.disabled).toBe(false);
    });
  });

  it("revokes a key on the second click of the armed-confirm pattern", async () => {
    render(<ApiKeysSection />);
    await flush();

    const revokeButton = screen.getByRole("button", { name: "Revoke Pointer" });
    await act(async () => {
      fireEvent.click(revokeButton);
    });
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Really revoke" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Really revoke" }));
    });
    expect(del).toHaveBeenCalledWith({ keyId: "key-1" });
  });
});
