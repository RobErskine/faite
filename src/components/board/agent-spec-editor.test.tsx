// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSpecEditor } from "./agent-spec-editor";
import type { Assignee, Todo } from "@/lib/schema";

afterEach(cleanup);

const todo = (overrides: Partial<Todo> = {}): Todo => ({
  id: "t1",
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  title: "Ship it",
  description: null,
  status: "open",
  priority: null,
  scheduledDate: null,
  scheduledAt: null,
  deadline: null,
  listId: null,
  projectId: null,
  labelIds: [],
  location: null,
  parentId: null,
  position: "a0",
  recurrenceRule: null,
  recurrenceParentId: null,
  completedAt: null,
  reminderTime: null,
  placeId: null,
  source: null,
  duplicateOf: null,
  duplicateHeld: null,
  suggestedListId: null,
  assigneeId: "a1",
  doneCriteria: [],
  access: null,
  ...overrides,
});

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

describe("AgentSpecEditor", () => {
  it("renders nothing for a person or an unassigned to-do", () => {
    const { container, rerender } = render(
      <AgentSpecEditor todo={todo()} assignee={assignee({ kind: "person" })} onSave={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
    rerender(<AgentSpecEditor todo={todo({ assigneeId: null })} assignee={undefined} onSave={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("names what is missing from validateAgentSpec", () => {
    render(<AgentSpecEditor todo={todo()} assignee={assignee()} onSave={vi.fn()} />);
    expect(screen.getByText(/Add at least one line to Done/)).toBeTruthy();
    expect(screen.getByText(/Declare Access/)).toBeTruthy();
  });

  it("adds a Done line authored by the user", () => {
    const onSave = vi.fn();
    render(<AgentSpecEditor todo={todo()} assignee={assignee()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("New Done line"), { target: { value: "Tests pass" } });
    fireEvent.keyDown(screen.getByLabelText("New Done line"), { key: "Enter" });
    const [id, patch] = onSave.mock.calls[0];
    expect(id).toBe("t1");
    expect(patch.doneCriteria).toEqual([
      expect.objectContaining({ text: "Tests pass", done: false, addedBy: null }),
    ]);
  });

  it("will not remove the last Done line", () => {
    render(
      <AgentSpecEditor
        todo={todo({ doneCriteria: [{ id: "c1", text: "Tests pass", done: false }], access: [] })}
        assignee={assignee()}
        onSave={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("Remove Tests pass") as HTMLButtonElement).disabled).toBe(true);
  });

  it("ticks a criterion", () => {
    const onSave = vi.fn();
    render(
      <AgentSpecEditor
        todo={todo({ doneCriteria: [{ id: "c1", text: "Tests pass", done: false }], access: [] })}
        assignee={assignee()}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByLabelText("Done: Tests pass"));
    expect(onSave.mock.calls[0][1].doneCriteria[0]).toMatchObject({ id: "c1", done: true });
  });

  it("declares access as needing nothing, then shows no problems", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <AgentSpecEditor
        todo={todo({ doneCriteria: [{ id: "c1", text: "x", done: false }] })}
        assignee={assignee()}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByText("Needs nothing"));
    expect(onSave).toHaveBeenCalledWith("t1", { access: [] });
    rerender(
      <AgentSpecEditor
        todo={todo({ doneCriteria: [{ id: "c1", text: "x", done: false }], access: [] })}
        assignee={assignee()}
        onSave={onSave}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Needs nothing.")).toBeTruthy();
  });

  it("adds an access item as needed and changes its status", () => {
    const onSave = vi.fn();
    render(
      <AgentSpecEditor
        todo={todo({ access: [{ name: "Repo", status: "needed" }] })}
        assignee={assignee()}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText("Status of Repo"), { target: { value: "blocked" } });
    expect(onSave).toHaveBeenLastCalledWith("t1", { access: [{ name: "Repo", status: "blocked" }] });
    fireEvent.change(screen.getByLabelText("New access item"), { target: { value: "Vault" } });
    fireEvent.keyDown(screen.getByLabelText("New access item"), { key: "Enter" });
    expect(onSave).toHaveBeenLastCalledWith("t1", {
      access: [
        { name: "Repo", status: "needed" },
        { name: "Vault", status: "needed" },
      ],
    });
  });
});
