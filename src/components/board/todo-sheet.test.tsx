// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TodoSheet, type RecurrenceInfo } from "./todo-sheet";
import { defaultRule } from "@/lib/recurrence";
import type { Todo } from "@/lib/schema";

/**
 * Same reason `day-sheet.test.tsx` stubs this: BlockNote is ProseMirror, which
 * needs layout APIs happy-dom does not have.
 */
vi.mock("@/components/ui/markdown-field", () => ({
  MarkdownField: ({ value, ariaLabel }: { value: string; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} defaultValue={value} readOnly />
  ),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const TODO: Todo = {
  id: "t1",
  ownerId: "local-user",
  createdAt: "2026-08-10T09:00:00.000Z",
  updatedAt: "2026-08-10T09:00:00.000Z",
  deletedAt: null,
  title: "Reply to the design feedback",
  description: null,
  status: "open",
  priority: null,
  scheduledDate: "2026-08-11",
  scheduledAt: "2026-08-10T13:35:00.000Z",
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
};

interface HarnessProps {
  backToDay?: string;
  onBackToDay?: () => void;
  onSetStatus?: (id: string, status: Todo["status"]) => void;
  onDelete?: (id: string) => void;
}

function Harness({ backToDay, onBackToDay, onSetStatus = vi.fn(), onDelete = vi.fn() }: HarnessProps) {
  return (
    <TodoSheet
      todo={TODO}
      lists={[]}
      tabs={[]}
      labels={[]}
      projects={[]}
      places={[]}
      onClose={vi.fn()}
      onSave={vi.fn()}
      onSetStatus={onSetStatus}
      onToggleLabel={vi.fn()}
      onDelete={onDelete}
      backToDay={backToDay}
      onBackToDay={onBackToDay}
    />
  );
}

const sheetContent = () => document.querySelector<HTMLElement>('[data-slot="sheet-content"]')!;

const RECURRENCE: RecurrenceInfo = {
  rule: defaultRule("2026-08-07"),
  seriesStart: "2026-08-07",
  occurrenceDate: "2026-08-11",
  summary: "Every week on Fri",
  nextDate: "2026-08-18",
  missedCount: null,
  onStop: vi.fn(),
  onChangeRule: vi.fn(),
  onRemoveSeries: vi.fn(),
};

describe("repeat section (a materialized occurrence)", () => {
  it("renders the schedule, Change…, and the actions menu without crashing", () => {
    render(
      <TodoSheet
        todo={{ ...TODO, recurrenceParentId: "template-1" }}
        lists={[]}
        tabs={[]}
        labels={[]}
        projects={[]}
        places={[]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSetStatus={vi.fn()}
        onToggleLabel={vi.fn()}
        onDelete={vi.fn()}
        recurrence={RECURRENCE}
      />,
    );
    expect(screen.getByText("Every week on Fri")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More repeat actions" })).toBeTruthy();
  });
});

describe("location field", () => {
  it("renders the autocomplete input, with and without saved places, without crashing", () => {
    const place = {
      id: "place-1",
      ownerId: "local-user",
      createdAt: "",
      updatedAt: "",
      deletedAt: null,
      name: "Home",
      address: "1 Main St",
      googlePlaceId: null,
      lat: null,
      lng: null,
    };
    render(
      <TodoSheet
        todo={TODO}
        lists={[]}
        tabs={[]}
        labels={[]}
        projects={[]}
        places={[place]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSetStatus={vi.fn()}
        onToggleLabel={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Location")).toBeTruthy();
  });
});

describe("footer", () => {
  it("renders Mark done, Won't do, and Delete as a 3-up row", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Mark done" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Won't do" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });
});

describe("keyboard shortcuts", () => {
  it("⌘Enter marks the todo done", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    fireEvent.keyDown(sheetContent(), { key: "Enter", metaKey: true });
    expect(onSetStatus).toHaveBeenCalledWith("t1", "done");
  });

  it("⌘Backspace marks the todo dropped (Won't do)", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    fireEvent.keyDown(sheetContent(), { key: "Backspace", metaKey: true });
    expect(onSetStatus).toHaveBeenCalledWith("t1", "dropped");
  });

  it("⇧⌘Backspace deletes", () => {
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);
    fireEvent.keyDown(sheetContent(), { key: "Backspace", metaKey: true, shiftKey: true });
    expect(onDelete).toHaveBeenCalledWith("t1");
  });

  it("does not fire ⌘Backspace while focus is in a text field — it means delete-to-line-start there", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    const title = screen.getByLabelText("Title");
    fireEvent.keyDown(title, { key: "Backspace", metaKey: true });
    expect(onSetStatus).not.toHaveBeenCalled();
  });

  it("requires exactly one of Ctrl/Meta — Ctrl+Meta together is a different chord", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    fireEvent.keyDown(sheetContent(), { key: "Enter", metaKey: true, ctrlKey: true });
    expect(onSetStatus).not.toHaveBeenCalled();
  });
});

describe("back-to-day affordance", () => {
  it("is absent when the sheet was not opened from a day's timeline", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
  });

  it("reads 'Back to <day>' and fires onBackToDay when opened from a day", () => {
    const onBackToDay = vi.fn();
    render(<Harness backToDay="2026-08-11" onBackToDay={onBackToDay} />);
    const button = screen.getByRole("button", { name: "Back to Aug 11" });
    fireEvent.click(button);
    expect(onBackToDay).toHaveBeenCalledTimes(1);
  });

  it("is absent if backToDay is set but no handler is wired (defensive)", () => {
    render(<Harness backToDay="2026-08-11" />);
    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
  });
});
