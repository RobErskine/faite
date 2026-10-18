// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AssigneesProvider } from "./assignees-context";
import { TodoMetaBadges } from "./todo-row-parts";
import type { Assignee, Todo } from "@/lib/schema";

afterEach(cleanup);

const assignee: Assignee = {
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
};

const todo = (overrides: Partial<Todo> = {}) =>
  ({
    id: "t1",
    labelIds: [],
    deadline: null,
    scheduledDate: null,
    reminderTime: null,
    status: "open",
    assigneeId: "a1",
    doneCriteria: [],
    access: null,
    ...overrides,
  }) as unknown as Todo;

const renderBadges = (t: Todo) =>
  render(
    <AssigneesProvider assignees={[assignee]}>
      <TodoMetaBadges todo={t} labels={[]} today="2026-08-05" />
    </AssigneesProvider>,
  );

describe("assignee chip on the card", () => {
  it("shows nothing for a to-do that is mine", () => {
    const { container } = renderBadges(todo({ assigneeId: null }));
    expect(container.querySelector("[data-row-badge='assignee']")).toBeNull();
  });

  it("shows the name and Done n/m", () => {
    renderBadges(
      todo({
        doneCriteria: [
          { id: "c1", text: "a", done: true },
          { id: "c2", text: "b", done: false },
        ],
      }),
    );
    expect(screen.getByText("Scout")).toBeTruthy();
    expect(document.querySelector("[data-assignee-progress]")?.textContent).toContain("Done 1/2");
  });

  it("shows a red dot only when access is blocked or needs setup", () => {
    const { rerender } = renderBadges(todo({ access: [{ name: "Repo", status: "granted" }] }));
    expect(screen.queryByLabelText("Access blocked or needs setup")).toBeNull();
    rerender(
      <AssigneesProvider assignees={[assignee]}>
        <TodoMetaBadges
          todo={todo({ access: [{ name: "Repo", status: "needs_setup" }] })}
          labels={[]}
          today="2026-08-05"
        />
      </AssigneesProvider>,
    );
    expect(screen.getByLabelText("Access blocked or needs setup")).toBeTruthy();
  });
});
