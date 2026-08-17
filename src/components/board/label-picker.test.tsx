// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LabelPicker } from "./label-picker";
import type { Label as LabelRecord, Todo } from "@/lib/schema";

beforeAll(() => {
  // Base UI's Autocomplete positioner reaches for this, same as every other
  // floating-ui-backed popup stubbed elsewhere in this suite.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const todo = (overrides: Partial<Todo> = {}): Todo => ({
  id: "t1",
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  title: "Reply to the design feedback",
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
  ...overrides,
});

const mkLabel = (id: string, name: string, overrides: Partial<LabelRecord> = {}): LabelRecord => ({
  id,
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  name,
  position: "a0",
  color: null,
  emoji: null,
  iconUrl: null,
  ...overrides,
});

const URGENT = mkLabel("lb1", "Urgent");
const ERRAND = mkLabel("lb2", "Errand");

const input = () => document.getElementById("todo-label-input")!;

/** Base UI's Item only commits a real click that started with a pointerdown
 * on the item itself — a bare `fireEvent.click()` alone is ignored. */
function selectOption(option: HTMLElement) {
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option);
}

/**
 * Base UI's Autocomplete only opens on a genuine typed `input` event — it
 * checks `nativeEvent.inputType` to tell real typing apart from an autofill,
 * and `fireEvent.change` never sets that (it dispatches a plain `Event`, not
 * an `InputEvent`). `fireEvent.input` does construct an `InputEvent`, so
 * `inputType` has to be passed explicitly here for the popup to open at all.
 */
function type(el: HTMLElement, value: string) {
  fireEvent.input(el, { target: { value }, inputType: "insertText" });
}

describe("LabelPicker — applied chips", () => {
  it("renders every applied label as a chip", () => {
    render(
      <LabelPicker
        todo={todo({ labelIds: ["lb1", "lb2"] })}
        labels={[URGENT, ERRAND]}
        onToggleLabel={vi.fn()}
      />,
    );
    expect(screen.getByText("Urgent")).toBeTruthy();
    expect(screen.getByText("Errand")).toBeTruthy();
  });

  it("removing a chip calls onToggleLabel", () => {
    const onToggleLabel = vi.fn();
    render(
      <LabelPicker todo={todo({ labelIds: ["lb1"] })} labels={[URGENT]} onToggleLabel={onToggleLabel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Urgent" }));
    expect(onToggleLabel).toHaveBeenCalledWith("t1", "lb1");
  });
});

describe("LabelPicker — picking from the dropdown", () => {
  it("filters to matching, unapplied labels as the user types", async () => {
    render(<LabelPicker todo={todo()} labels={[URGENT, ERRAND]} onToggleLabel={vi.fn()} />);
    type(input(), "urg");

    expect(await screen.findByRole("option", { name: "Urgent" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Errand" })).toBeNull();
  });

  it("excludes an already-applied label from the dropdown", async () => {
    render(
      <LabelPicker
        todo={todo({ labelIds: ["lb1"] })}
        labels={[URGENT, ERRAND]}
        onToggleLabel={vi.fn()}
      />,
    );
    // Both labels contain "e" ("Urgent", "Errand") — a query that would
    // surface both if exclusion were broken, only one if it isn't.
    type(input(), "e");

    expect(await screen.findByRole("option", { name: "Errand" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Urgent" })).toBeNull();
  });

  it("picking a label calls onToggleLabel and clears the input", async () => {
    const onToggleLabel = vi.fn();
    render(<LabelPicker todo={todo()} labels={[URGENT]} onToggleLabel={onToggleLabel} />);
    type(input(), "urg");

    const option = await screen.findByRole("option", { name: "Urgent" });
    selectOption(option);

    expect(onToggleLabel).toHaveBeenCalledWith("t1", "lb1");
    expect(input()).toHaveProperty("value", "");
  });
});

describe("LabelPicker — create new", () => {
  it("offers to create a label when the query matches nothing", async () => {
    render(<LabelPicker todo={todo()} labels={[URGENT]} onToggleLabel={vi.fn()} />);
    type(input(), "brand-new");

    expect(await screen.findByRole("option", { name: /Create label .brand-new./ })).toBeTruthy();
  });

  it("does not offer to create when an existing label matches exactly, case-insensitively", async () => {
    render(<LabelPicker todo={todo()} labels={[URGENT]} onToggleLabel={vi.fn()} />);
    type(input(), "urgent");

    await screen.findByRole("option", { name: "Urgent" });
    expect(screen.queryByText(/Create label/)).toBeNull();
  });

  it("creating a label toggles it on and clears the input once it resolves", async () => {
    const onToggleLabel = vi.fn();
    render(<LabelPicker todo={todo()} labels={[]} onToggleLabel={onToggleLabel} />);
    type(input(), "brand-new");

    const createRow = await screen.findByRole("option", { name: /Create label .brand-new./ });
    selectOption(createRow);

    await vi.waitFor(() => expect(onToggleLabel).toHaveBeenCalledTimes(1));
    expect(onToggleLabel.mock.calls[0][0]).toBe("t1");
    expect(typeof onToggleLabel.mock.calls[0][1]).toBe("string");
    expect(input()).toHaveProperty("value", "");
  });
});
