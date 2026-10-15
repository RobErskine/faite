// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LoopExampleCards } from "./loop-example";

afterEach(cleanup);

const base = { today: "2026-10-15", workdaysOnly: false, workdays: [1, 2, 3, 4, 5] };

const renderExample = (overflowAfterDays: number) =>
  render(
    <TooltipProvider>
      <LoopExampleCards ctx={{ ...base, overflowAfterDays }} />
    </TooltipProvider>,
  );

const captions = () =>
  [...document.querySelectorAll("[data-loop-caption]")].map((p) => p.textContent);
const age = () => document.querySelector("[data-overflow-age]")?.textContent;

/**
 * EI-390: the Overflow box used to read "since today" under "Oct 19" while
 * the reader's today was Oct 15. Each caption now names the box's own day,
 * and the Overflow box is drawn two days after the crossing so its badge
 * shows the whole form, with a date that agrees with the box before it.
 */
describe("LoopExampleCards — dates and the age agree (EI-390)", () => {
  it("captions every box with its own day, and ages Overflow from the crossing", () => {
    // Missed Oct 15, rolls to Oct 16, 17, 18, crosses into Overflow Oct 19.
    renderExample(3);
    expect(captions()).toEqual(["On Oct 15", "On Oct 18 · 3 days", "On Oct 21"]);
    expect(age()).toBe("since Oct 19 · 2 days");
  });

  it("holds with no rolls at all", () => {
    // Missed Oct 15, straight into Overflow Oct 16.
    renderExample(0);
    expect(captions()).toEqual(["On Oct 15", "On Oct 18"]);
    expect(age()).toBe("since Oct 16 · 2 days");
  });
});
