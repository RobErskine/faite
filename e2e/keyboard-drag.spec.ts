import { test, expect } from "./support/fixtures";

/**
 * Tier A — keyboard drag-and-drop, exercised end to end for the first time
 * (EI-74; docs/DRAG-AND-DROP.md §7 item 1). dnd-kit's KeyboardSensor has been
 * wired since P1 but never driven by a real keyboard in this suite.
 *
 * `desktop` only — this is a keyboard path, not a touch or viewport one.
 * Enforced by `desktop`'s `testMatch` in playwright.config.ts, which is where
 * every spec-to-project mapping now lives (EI-187); see docs/E2E.md §8.
 *
 * Activation: `.focus()` a card's drag grip
 * (`aria-label="Drag to reschedule or reorder <title>"`, `todo-card.tsx`),
 * `Space` lifts, arrows move, `Space` drops, `Escape` cancels — the
 * `startKeyboardDrag` handler is dnd-kit's own
 * `useSortable().listeners.onKeyDown`.
 *
 * `keyboardCoordinates`/`collisionDetection` (`use-board-actions.ts`) replace
 * dnd-kit's bare `sortableKeyboardCoordinates` as of EI-114. The stock getter
 * scores candidates by averaged 4-corner distance, which structurally favors
 * a small card rect over a large EMPTY column's rect even when the column is
 * the nearer of the two — an empty column, or the pinned Backlog rail
 * crossing into the calendar half, could be silently stepped over or never
 * reached. See docs/DRAG-AND-DROP.md §7 item 1 for the full diagnosis. The
 * cross-column cases below no longer need to seed the destination with a
 * todo first purely to make it reachable — the "known gap" tests at the
 * bottom specifically exercise the empty-destination cases that used to be
 * invisible to the keyboard path.
 */
test.describe("keyboard drag and drop", () => {
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
   * EI-114 (split out of EI-74, where this started as `test.fixme`).
   * `sortableKeyboardCoordinates` scores the pinned Backlog rail's own column
   * and a day column by averaged 4-corner distance — Backlog's rect and the
   * tab strip immediately below it are both much closer than any day column,
   * so the first couple of `ArrowUp` presses land there instead of making
   * visible progress toward the calendar half. Two presses is enough to
   * clear that near-field cluster and reach Tuesday; see
   * docs/DRAG-AND-DROP.md §7 item 1 for the full diagnosis and the fix
   * (`collisionDetection`'s self-collision exclusion in `use-board-actions.ts`).
   */
  test("moves a card from the pinned Backlog rail into a day column", async ({ page }) => {
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
    await page.waitForTimeout(250);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(250); // let dnd-kit process the move before dropping
    await page.keyboard.press("Space");

    await expect(async () => {
      expect(await tuesday.locator("text=Backlog item").count()).toBe(1);
      expect(await backlog.locator("text=Backlog item").count()).toBe(0);
    }).toPass({ timeout: 5_000 });
  });

  /**
   * EI-114's second reported instance: an empty list column sitting between
   * two populated ones was silently stepped over by arrow-key navigation
   * (reported live as Grocery List → empty To Buy → To Read, where To Buy
   * never got focus). Unlike the Backlog case above, this lands on the
   * empty destination in a single press once fixed — see
   * `keyboardCoordinates` in `use-board-actions.ts` for why: it scores
   * whole-column candidates by leading-edge distance rather than the
   * corner-averaged metric that let a populated neighbor's small card rect
   * out-score the empty column's larger one.
   */
  test("moves a card into an empty list column between two populated ones", async ({ page }) => {
    // Seed data already ships Grocery List / To Buy / To Read in that order
    // (`repositories.ts`) — To Buy stays empty, which is the point.
    const grocery = page.getByRole("region", { name: "Grocery List" });
    const toBuy = page.getByRole("region", { name: "To Buy" });
    const toRead = page.getByRole("region", { name: "To Read" });
    await grocery.getByPlaceholder("Add a to-do").fill("Milk");
    await page.keyboard.press("Enter");
    await toRead.getByPlaceholder("Add a to-do").fill("Book");
    await page.keyboard.press("Enter");

    const grip = page.getByRole("button", { name: "Drag to reschedule or reorder Milk" });
    await grip.focus();
    await page.waitForTimeout(200); // let React attach dnd-kit's keyboard activator before Space
    await page.keyboard.press("Space");
    await page.waitForTimeout(250); // let dnd-kit process the lift before moving
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250); // let dnd-kit process the move before dropping
    await page.keyboard.press("Space");

    await expect(async () => {
      expect(await toBuy.locator("text=Milk").count()).toBe(1);
      expect(await grocery.locator("text=Milk").count()).toBe(0);
      expect(await toRead.locator("text=Milk").count()).toBe(0);
    }).toPass({ timeout: 5_000 });
  });

  /**
   * The calendar-half counterpart of the empty-list-column case above: an
   * empty day column (Wednesday) between two populated ones (Tuesday,
   * Thursday). Same mechanism, different track — day columns lay out in one
   * horizontal row exactly like list columns do (§4.12), so
   * `keyboardCoordinates`'s same-row leading-edge scoring applies here too.
   */
  test("moves a card into an empty day column between two populated ones", async ({ page }) => {
    const tuesday = page.getByRole("region", { name: "Tuesday" }).first();
    const wednesday = page.getByRole("region", { name: "Wednesday" }).first();
    const thursday = page.getByRole("region", { name: "Thursday" }).first();
    await tuesday.getByPlaceholder("Add a to-do").fill("Tue item");
    await page.keyboard.press("Enter");
    await thursday.getByPlaceholder("Add a to-do").fill("Thu item");
    await page.keyboard.press("Enter");

    const grip = page.getByRole("button", { name: "Drag to reschedule or reorder Tue item" });
    await grip.focus();
    await page.waitForTimeout(200); // let React attach dnd-kit's keyboard activator before Space
    await page.keyboard.press("Space");
    await page.waitForTimeout(250); // let dnd-kit process the lift before moving
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250); // let dnd-kit process the move before dropping
    await page.keyboard.press("Space");

    await expect(async () => {
      expect(await wednesday.locator("text=Tue item").count()).toBe(1);
      expect(await tuesday.locator("text=Tue item").count()).toBe(0);
      expect(await thursday.locator("text=Tue item").count()).toBe(0);
    }).toPass({ timeout: 5_000 });
  });
});
