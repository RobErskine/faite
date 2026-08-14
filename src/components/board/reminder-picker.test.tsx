// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ReminderPicker } from "./reminder-picker";
import type { ReminderPreset, Todo } from "@/lib/schema";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const todo = (overrides: Partial<Todo> = {}): Todo => ({
  id: "t1",
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  title: "Call the vet",
  description: null,
  status: "open",
  priority: null,
  scheduledDate: "2026-08-14",
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
  ...overrides,
});

const mkPreset = (
  id: string,
  name: string,
  time: string,
  overrides: Partial<ReminderPreset> = {},
): ReminderPreset => ({
  id,
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  name,
  time,
  position: "a0",
  color: null,
  emoji: "🌅",
  iconUrl: null,
  ...overrides,
});

const MORNING = mkPreset("p1", "In the morning", "08:00");
const LUNCH = mkPreset("p2", "Lunchtime", "12:30", { emoji: "🥪" });

const input = () => document.getElementById("todo-reminder-input")!;

/** Base UI's Item only commits a real click that started with a pointerdown
 * on the item itself — a bare `fireEvent.click()` alone is ignored. */
function selectOption(option: HTMLElement) {
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option);
}

/** `fireEvent.change` never opens the popup — see docs/PICKERS.md §4. */
function type(el: HTMLElement, value: string) {
  fireEvent.input(el, { target: { value }, inputType: "insertText" });
}

describe("ReminderPicker — resting state", () => {
  it("shows a neutral placeholder with no reminder set", () => {
    render(<ReminderPicker todo={todo()} presets={[MORNING]} onSave={vi.fn()} />);
    expect(input()).toHaveProperty("placeholder", "Add a reminder…");
  });

  it("shows the matching preset's label as the placeholder", () => {
    render(
      <ReminderPicker
        todo={todo({ reminderTime: "08:00" })}
        presets={[MORNING]}
        onSave={vi.fn()}
      />,
    );
    expect(input()).toHaveProperty("placeholder", "🌅 In the morning");
  });

  it("shows a formatted clock time when the reminder matches no preset", () => {
    render(
      <ReminderPicker
        todo={todo({ reminderTime: "15:45" })}
        presets={[MORNING]}
        onSave={vi.fn()}
      />,
    );
    expect(input()).toHaveProperty("placeholder", "3:45 PM");
  });

  it("renders a clear button only when a reminder is set", () => {
    const { rerender } = render(
      <ReminderPicker todo={todo()} presets={[MORNING]} onSave={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Clear reminder" })).toBeNull();

    rerender(
      <ReminderPicker
        todo={todo({ reminderTime: "08:00" })}
        presets={[MORNING]}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Clear reminder" })).toBeTruthy();
  });

  it("clearing writes reminderTime: null", () => {
    const onSave = vi.fn();
    render(
      <ReminderPicker todo={todo({ reminderTime: "08:00" })} presets={[MORNING]} onSave={onSave} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear reminder" }));
    expect(onSave).toHaveBeenCalledWith("t1", { reminderTime: null });
  });
});

describe("ReminderPicker — picking a preset", () => {
  // `openOnInputClick` does not reliably open the popup under
  // fireEvent.click/pointerDown in happy-dom — a documented Base UI gap, see
  // docs/PICKERS.md §4. Typing a query is the substitute that doc prescribes;
  // "empty query lists every preset" is already covered by
  // reminder-presets.test.ts's parsePresetQuery unit tests.

  it("filters presets by name", async () => {
    render(<ReminderPicker todo={todo()} presets={[MORNING, LUNCH]} onSave={vi.fn()} />);
    type(input(), "morn");

    expect(await screen.findByRole("option", { name: /In the morning/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Lunchtime/ })).toBeNull();
  });

  it("picking a preset writes its time and clears the query", async () => {
    const onSave = vi.fn();
    render(<ReminderPicker todo={todo()} presets={[MORNING]} onSave={onSave} />);
    type(input(), "morn");

    const option = await screen.findByRole("option", { name: /In the morning/ });
    selectOption(option);

    expect(onSave).toHaveBeenCalledWith("t1", { reminderTime: "08:00" });
    expect(input()).toHaveProperty("value", "");
  });
});

describe("ReminderPicker — a bare time", () => {
  it("offers 'Remind at' for a parsed time with no matching preset", async () => {
    render(<ReminderPicker todo={todo()} presets={[MORNING]} onSave={vi.fn()} />);
    type(input(), "9:30am");

    expect(await screen.findByRole("option", { name: /Remind at 9:30 AM/ })).toBeTruthy();
  });

  it("picking a bare time writes reminderTime and creates no preset", async () => {
    const onSave = vi.fn();
    render(<ReminderPicker todo={todo()} presets={[]} onSave={onSave} />);
    type(input(), "14:00");

    const option = await screen.findByRole("option", { name: /Remind at 2:00 PM/ });
    selectOption(option);

    expect(onSave).toHaveBeenCalledWith("t1", { reminderTime: "14:00" });
  });
});

describe("ReminderPicker — create a preset", () => {
  it("offers to create a preset for 'name time'", async () => {
    render(<ReminderPicker todo={todo()} presets={[]} onSave={vi.fn()} />);
    type(input(), "gym 9:30am");

    expect(
      await screen.findByRole("option", { name: /Create preset .gym. at 9:30 AM/ }),
    ).toBeTruthy();
  });

  it("creating a preset applies its time once it resolves", async () => {
    const onSave = vi.fn();
    render(<ReminderPicker todo={todo()} presets={[]} onSave={onSave} />);
    type(input(), "gym 9:30am");

    const createRow = await screen.findByRole("option", { name: /Create preset .gym./ });
    selectOption(createRow);

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith("t1", { reminderTime: "09:30" }));
  });

  it("shows 'No reminder presets match' for a query that is neither a name nor a time", async () => {
    render(<ReminderPicker todo={todo()} presets={[MORNING]} onSave={vi.fn()} />);
    type(input(), "totally unrelated words");

    expect(await screen.findByText("No reminder presets match.")).toBeTruthy();
  });
});

describe("ReminderPicker — Escape", () => {
  it("closes the popup without throwing or committing a pick", async () => {
    const onSave = vi.fn();
    render(<ReminderPicker todo={todo()} presets={[MORNING]} onSave={onSave} />);
    type(input(), "morn");
    await screen.findByRole("option", { name: /In the morning/ });

    fireEvent.keyDown(input(), { key: "Escape" });

    expect(screen.queryByRole("option", { name: /In the morning/ })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });
});
