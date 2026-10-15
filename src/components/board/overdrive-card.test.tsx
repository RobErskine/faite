// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Todo } from "@/lib/schema";
import type { PlacementContext } from "@/lib/scheduling";
import { OverdriveCard } from "./overdrive-card";

afterEach(cleanup);

const ctx: PlacementContext = {
  today: "2026-10-14",
  visibleWindow: ["2026-10-14"],
  workdaysOnly: false,
  workdays: [1, 2, 3, 4, 5],
  overflowAfterDays: 3,
};

const todo = (overrides: Partial<Todo> = {}): Todo => ({
  id: "t1",
  ownerId: "local-user",
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z",
  deletedAt: null,
  title: "Renew visa",
  description: null,
  status: "open",
  priority: null,
  scheduledDate: "2026-10-01",
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
  ...overrides,
});

const renderCard = (t: Todo) =>
  render(
    <TooltipProvider>
      <OverdriveCard todo={t} list={null} labels={[]} ctx={ctx} index={0} total={1} />
    </TooltipProvider>,
  );

const age = () => document.querySelector("[data-overflow-age]")?.textContent;

/**
 * EI-390: a bare "9 days" under "Scheduled Oct 1" read as "9 days late". The
 * badge now says since when as well as how long — the board card's string.
 */
describe("OverdriveCard — the Overflow age (EI-390)", () => {
  it("says since when and how long, beside the scheduled date", () => {
    // Scheduled Oct 1: rolled Oct 2–4, crossed into Overflow Oct 5.
    renderCard(todo());
    expect(screen.getByText(/Scheduled Oct 1/)).toBeTruthy();
    expect(age()).toBe("since Oct 5 · 9 days");
  });

  it("reads 'since today' on the day it crossed", () => {
    renderCard(todo({ scheduledDate: "2026-10-10" })); // overflowed Oct 14
    expect(age()).toBe("since today");
  });

  it("names the year on a start in another year", () => {
    renderCard(todo({ scheduledDate: "2025-12-20" })); // overflowed Dec 24, 2025
    expect(age()).toBe("since Dec 24, 2025 · 294 days");
  });
});
