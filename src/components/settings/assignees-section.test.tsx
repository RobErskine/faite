// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assignee } from "@/lib/schema";
import { AssigneesSection } from "./assignees-section";

const { rows, session, create, update, del, apiCreate, apiUpdate, apiDelete } = vi.hoisted(() => ({
  rows: { current: [] as unknown[] },
  session: { current: { user: { id: "u" } } as unknown },
  create: vi.fn(async () => "new-id"),
  update: vi.fn(async () => {}),
  del: vi.fn(async () => {}),
  apiCreate: vi.fn(),
  apiUpdate: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/store/hooks", () => ({ useAssignees: () => rows.current }));
vi.mock("@/lib/store/repositories", () => ({
  createAssignee: create,
  updateAssignee: update,
  deleteAssignee: del,
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: session.current }),
  authClient: {
    apiKey: { create: apiCreate, update: apiUpdate, delete: apiDelete },
  },
}));

function assignee(over: Partial<Assignee>): Assignee {
  return {
    id: "a1",
    ownerId: "o",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    name: "Claude",
    kind: "agent",
    color: null,
    instructions: null,
    apiKeyId: null,
    ...over,
  };
}

beforeEach(() => {
  rows.current = [];
  session.current = { user: { id: "u" } };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AssigneesSection", () => {
  it("adds an agent with the chosen color", async () => {
    render(<AssigneesSection />);
    fireEvent.change(document.getElementById("assignee-name")!, { target: { value: "Claude" } });
    fireEvent.click(screen.getByRole("button", { name: "New assignee color" }));
    fireEvent.click(await screen.findByRole("button", { name: "Violet" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    });
    expect(create).toHaveBeenCalledWith("Claude", "agent", { color: "#6e56cf" });
  });

  it("adds a person when Person is picked", async () => {
    render(<AssigneesSection />);
    fireEvent.change(document.getElementById("assignee-name")!, { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("switch")); // agent → person
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    });
    expect(create).toHaveBeenCalledWith("Sam", "person", { color: null });
  });

  it("creates a read-write key for an agent and stores its id", async () => {
    rows.current = [assignee({})];
    apiCreate.mockResolvedValue({ data: { id: "key-1", key: "secret-key" }, error: null });
    apiUpdate.mockResolvedValue({ error: null });
    render(<AssigneesSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create key/ }));
    });
    expect(apiCreate).toHaveBeenCalledWith({ name: "Agent: Claude", configId: "read-write" });
    expect(update).toHaveBeenCalledWith("a1", { apiKeyId: "key-1" });
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("secret-key");
  });

  it("does not offer a key to a person", () => {
    rows.current = [assignee({ kind: "person" })];
    render(<AssigneesSection />);
    expect(screen.queryByRole("button", { name: /Create key/ })).toBeNull();
  });

  it("hides Create key when signed out", () => {
    rows.current = [assignee({})];
    session.current = null;
    render(<AssigneesSection />);
    expect(screen.queryByRole("button", { name: /Create key/ })).toBeNull();
  });

  it("delete is two-step, revokes the bound key and rehomes to-dos", async () => {
    rows.current = [assignee({ apiKeyId: "key-1" })];
    apiDelete.mockResolvedValue({ error: null });
    render(<AssigneesSection />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Claude" }));
    expect(del).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Really delete" }));
    });
    expect(apiDelete).toHaveBeenCalledWith({ keyId: "key-1" });
    expect(del).toHaveBeenCalledWith("a1");
  });

  it("saves edited name and instructions", async () => {
    rows.current = [assignee({})];
    render(<AssigneesSection />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Claude" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Claude 2" } });
    fireEvent.change(screen.getByLabelText("Instructions"), { target: { value: "Be brief" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(update).toHaveBeenCalledWith("a1", {
      name: "Claude 2",
      color: null,
      instructions: "Be brief",
    });
  });
});
