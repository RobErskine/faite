import { test, expect } from "./support/fixtures";

/**
 * Tier A — keyboard drag-and-drop, exercised end to end for the first time
 * (EI-74; docs/DRAG-AND-DROP.md §7 item 1). dnd-kit's KeyboardSensor has been
 * wired since P1 but never driven by a real keyboard in this suite.
 *
 * `desktop` only — this is a keyboard path, not a touch or viewport one; see
 * `desktop-layout.spec.ts` for the same guard pattern.
 *
 * Activation: `.focus()` a card's drag grip
 * (`aria-label="Drag to reschedule or reorder <title>"`, `todo-card.tsx`),
 * `Space` lifts, arrows move, `Space` drops, `Escape` cancels — the
 * `startKeyboardDrag` handler is dnd-kit's own
 * `useSortable().listeners.onKeyDown`.
 *
 * `sortableKeyboardCoordinates` (the default coordinate getter, wired in
 * `use-board-actions.ts`) only finds a landing rect near an EXISTING sortable
 * item — an empty column, or a column with no `useSortable` item registered
 * in it yet, is invisible to it. Every cross-column case below seeds the
 * destination with a todo first for that reason; this is not a test
 * convenience, it is a real constraint on the keyboard path today (see the
 * "known gap" test at the bottom).
 */
test.describe("keyboard drag and drop", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "keyboard path, not a viewport one");
  });

  test("Space lifts a card and Escape cancels, leaving order unchanged", async ({ page }) => {
    const backlog = page.getByRole("region", { name: "Backlog" });
    const addField = backlog.getByPlaceholder("Add a to-do");
    await addField.fill("Alpha");
    await page.keyboard.press("Enter");
    await addField.fill("Beta");
    await page.keyboard.press("Enter");

    const alpha = page.getByRole("button", { name: "Alpha", exact: true });
    const beta = page.getByRole("button", { name: "Beta", exact: true });
    await expect(alpha).toBeVisible();
    await expect(beta).toBeVisible();

    const betaGrip = page.getByRole("button", { name: "Drag to reschedule or reorder Beta" });
    await betaGrip.focus();
    await page.waitForTimeout(200); // let React attach dnd-kit's keyboard activator before Space
    await page.keyboard.press("Space"); // lift
    await page.waitForTimeout(250); // let dnd-kit process the lift before moving
    await page.keyboard.press("ArrowUp"); // stage a reorder above Alpha
    await page.waitForTimeout(250); // let dnd-kit process the move before cancelling
    await page.keyboard.press("Escape"); // cancel — must not commit

    // Alpha was added first, so it stays above Beta if the cancel held.
    await expect(async () => {
      const alphaY = (await alpha.boundingBox())!.y;
      const betaY = (await beta.boundingBox())!.y;
      expect(alphaY).toBeLessThan(betaY);
    }).toPass({ timeout: 5_000 });
  });

  test("reorders within a column via arrows", async ({ page }) => {
    const backlog = page.getByRole("region", { name: "Backlog" });
    const addField = backlog.getByPlaceholder("Add a to-do");
    await addField.fill("First todo");
    await page.keyboard.press("Enter");
    await addField.fill("Second todo");
    await page.keyboard.press("Enter");

    // exact: true — the grip's own aria-label substring-matches the title
    // too (see core-flows.spec.ts for the same collision).
    const first = page.getByRole("button", { name: "First todo", exact: true });
    const second = page.getByRole("button", { name: "Second todo", exact: true });
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();

    const secondGrip = page.getByRole("button", {
      name: "Drag to reschedule or reorder Second todo",
    });
    await secondGrip.focus();
    await page.waitForTimeout(200); // let React attach dnd-kit's keyboard activator before Space
    await page.keyboard.press("Space"); // lift
    await page.waitForTimeout(250); // let dnd-kit process the lift before moving
    await page.keyboard.press("ArrowUp"); // move above First todo
    await page.waitForTimeout(250); // let dnd-kit process the move before dropping
    await page.keyboard.press("Space"); // drop

    await expect(async () => {
      const firstY = (await first.boundingBox())!.y;
      const secondY = (await second.boundingBox())!.y;
      expect(secondY).toBeLessThan(firstY);
    }).toPass({ timeout: 5_000 });
  });

  test("moves a card into an adjacent day column", async ({ page }) => {
    const tuesday = page.getByRole("region", { name: "Tuesday" }).first();
    const wednesday = page.getByRole("region", { name: "Wednesday" }).first();

    // Wednesday needs an existing sortable item — see the module doc comment.
    await tuesday.getByPlaceholder("Add a to-do").fill("Todo A");
    await page.keyboard.press("Enter");
    await wednesday.getByPlaceholder("Add a to-do").fill("Todo B");
    await page.keyboard.press("Enter");

    const grip = page.getByRole("button", { name: "Drag to reschedule or reorder Todo A" });
    await expect(grip).toBeVisible();
    await grip.focus();
    await page.waitForTimeout(200); // let React attach dnd-kit's keyboard activator before Space
    await page.keyboard.press("Space"); // lift
    await page.waitForTimeout(250); // let dnd-kit process the lift before moving
    await page.keyboard.press("ArrowRight"); // land on Wednesday's existing card
    await page.waitForTimeout(250); // let dnd-kit process the move before dropping
    await page.keyboard.press("Space"); // drop

    await expect(async () => {
      expect(await tuesday.locator("text=Todo A").count()).toBe(0);
      expect(await wednesday.locator("text=Todo A").count()).toBe(1);
    }).toPass({ timeout: 5_000 });
  });

  test("cancelling mid-drag with Escape leaves a cross-column move uncommitted", async ({
    page,
  }) => {
    const tuesday = page.getByRole("region", { name: "Tuesday" }).first();
    const wednesday = page.getByRole("region", { name: "Wednesday" }).first();
    await tuesday.getByPlaceholder("Add a to-do").fill("Stays put");
    await page.keyboard.press("Enter");
    await wednesday.getByPlaceholder("Add a to-do").fill("Wednesday anchor");
    await page.keyboard.press("Enter");

    const grip = page.getByRole("button", { name: "Drag to reschedule or reorder Stays put" });
    await grip.focus();
    await page.waitForTimeout(200); // let React attach dnd-kit's keyboard activator before Space
    await page.keyboard.press("Space");
    await page.waitForTimeout(250); // let dnd-kit process the lift before moving
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250); // let dnd-kit process the move before cancelling
    await page.keyboard.press("Escape");

    await expect(async () => {
      expect(await tuesday.locator("text=Stays put").count()).toBe(1);
      expect(await wednesday.locator("text=Stays put").count()).toBe(0);
    }).toPass({ timeout: 5_000 });
  });

  /**
   * Known gap, found while writing this spec — reported to EI-74, not
   * silently worked around. `sortableKeyboardCoordinates` cannot move a card
   * from the pinned Backlog rail into the calendar half (or presumably the
   * reverse) via arrow keys: tried 1 through 6 `ArrowUp` presses (each given
   * a full 250ms to process, same pacing as the passing tests above) against
   * a Tuesday column that already held a todo — ruling out both the "needs
   * an existing sortable item" constraint documented above and plain
   * key-press pacing, which is what turned out to be the cause of the
   * flakiness this spec had before this comment was written. The card never
   * left Backlog in any of the 6 trials. The within-half cases above
   * (Backlog reorder, day-to-day) both work reliably with a single arrow
   * press, so this looks specific to crossing the planning/calendar
   * boundary — plausibly because the two halves' rects don't satisfy
   * whatever directional-adjacency check the coordinate getter uses across
   * that boundary. A mouse or touch drag is unaffected; this is a
   * keyboard-only gap.
   *
   * Left as `fixme` rather than deleted so it shows up in the Playwright
   * report instead of silently not existing. See the EI-74 Linear comment
   * for the full writeup.
   */
  test.fixme(
    "moves a card from the pinned Backlog rail into a day column",
    async ({ page }) => {
      const backlog = page.getByRole("region", { name: "Backlog" });
      const tuesday = page.getByRole("region", { name: "Tuesday" }).first();
      await backlog.getByPlaceholder("Add a to-do").fill("Backlog item");
      await page.keyboard.press("Enter");
      await tuesday.getByPlaceholder("Add a to-do").fill("Tuesday item");
      await page.keyboard.press("Enter");

      const grip = page.getByRole("button", {
        name: "Drag to reschedule or reorder Backlog item",
      });
      await grip.focus();
      await page.waitForTimeout(200); // let React attach dnd-kit's keyboard activator before Space
      await page.keyboard.press("Space");
      await page.waitForTimeout(250); // let dnd-kit process the lift before moving
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(250); // let dnd-kit process the move before dropping
      await page.keyboard.press("Space");

      await expect(async () => {
        expect(await tuesday.locator("text=Backlog item").count()).toBe(1);
      }).toPass({ timeout: 5_000 });
    },
  );
});
