// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssigneePicker } from "./assignee-picker";
import type { Assignee } from "@/lib/schema";

afterEach(cleanup);

const assignee = (overrides: Partial<Assignee> = {}): Assignee => ({
  id: "a1",
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  name: "Scout",
  kind: "agent",
  color: null,
  instructions: null,
  apiKeyId: null,
  ...overrides,
});

describe("AssigneePicker", () => {
  it("reads me when unassigned", () => {
    render(<AssigneePicker value={null} assignees={[assignee()]} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox").textContent).toContain("Me");
  });

  it("shows the assignee's name", () => {
    render(<AssigneePicker value="a1" assignees={[assignee()]} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox").textContent).toContain("Scout");
  });

  it("falls back for an assignee that no longer exists", () => {
    render(<AssigneePicker value="gone" assignees={[assignee()]} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox").textContent).toContain("Removed assignee");
  });
});
