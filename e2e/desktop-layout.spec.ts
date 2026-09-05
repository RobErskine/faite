import { test, expect } from "./support/fixtures";

/**
 * Tier A — structural contract for the two-half desktop board.
 *
 * This is the safety net for the P2 extraction in the mobile plan
 * (board.tsx -> use-board-data/use-board-ui-state/use-board-actions): there is
 * no `board.test.tsx`, so this suite is the only thing standing between that
 * refactor and a silent regression. Assertions are on structure (what's in
 * the DOM, roughly where) rather than pixels — see docs/E2E.md "Tier A".
 *
 * `desktop` project only (playwright.config.ts, 1440x900) — this is the
 * one layout that exists today.
 */
test.describe("desktop board layout", () => {
  // Runs once, not once per project — declared by `desktop`'s `testMatch` in
  // playwright.config.ts, not by a `test.skip` guard in here. The guard did
  // work, but only after Playwright had already scheduled and started five
  // copies of every test to throw four of them away; `testMatch` never
  // creates them. `core-flows.spec.ts` is the suite that wants every project.
  test("renders a full week of day columns plus the pinned Overflow rail", async ({ page }) => {
    // Frozen on a Tuesday (support/fixtures.ts) with default visibleDays=7
    // and showWeekends=true, so all seven weekdays render as full columns —
    // none collapse into a WeekendColumn strip. `.first()`: the track
    // pre-renders well past one week (DEFAULT_RENDERED_DAYS in board.tsx),
    // so each weekday name recurs every 7 columns — `.first()` is always
    // this week's, since columns render in date order starting today.
    const weekdays = [
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
      "Monday",
    ];
    for (const day of weekdays) {
      await expect(page.getByRole("region", { name: day }).first()).toBeVisible();
    }
    await expect(page.getByRole("region", { name: "Overflow" })).toBeVisible();
  });

  test("renders the pinned Backlog rail plus the default planning lists", async ({ page }) => {
    // src/lib/store/repositories.ts SEED_LISTS — seeded once by useBootstrap()
    // on first boot into any empty IndexedDB.
    for (const list of ["Backlog", "Brain Dump", "Grocery List", "To Buy", "To Read"]) {
      await expect(page.getByRole("region", { name: list })).toBeVisible();
    }
  });

  test("has the vertical split handle between the two halves", async ({ page }) => {
    const splitHandle = page.getByRole("separator", {
      name: "Resize the calendar and list panes",
    });
    await expect(splitHandle).toBeVisible();

    // The seam is a horizontal bar separating a vertically-stacked calendar
    // half (above) from planning half (below) — the two-half board's defining
    // structural property, and the one thing a phone-width shell (P3 in the
    // mobile plan) cannot preserve. Assert calendar content sits above it and
    // planning content sits below.
    const splitBox = await splitHandle.boundingBox();
    const overflowBox = await page.getByRole("region", { name: "Overflow" }).boundingBox();
    const backlogBox = await page.getByRole("region", { name: "Backlog" }).boundingBox();
    expect(splitBox).not.toBeNull();
    expect(overflowBox).not.toBeNull();
    expect(backlogBox).not.toBeNull();
    expect(overflowBox!.y).toBeLessThan(splitBox!.y);
    expect(backlogBox!.y).toBeGreaterThan(splitBox!.y);
  });

  test("has independently resizable Backlog and Overflow rails", async ({ page }) => {
    await expect(
      page.getByRole("separator", { name: "Resize the Backlog column" }),
    ).toBeVisible();
    await expect(
      page.getByRole("separator", { name: "Resize the Overflow column" }),
    ).toBeVisible();
  });

  test("resizes day columns to fill the track when the day-count view changes", async ({
    page,
  }) => {
    // The track container's own width never changes when `visibleDays`
    // changes — only the columns inside it do — so it's a stable reference
    // for what "fill the track" should mean, measured before the picker
    // touches anything. `.column-track` also matches the planning half's
    // list track and the tab strip, so scope to the one holding a day
    // column (`[data-day-column]`, set only on the calendar half).
    const track = page.locator(".column-track").filter({ has: page.locator("[data-day-column]") });
    const trackBox = await track.boundingBox();
    expect(trackBox).not.toBeNull();

    await page.getByRole("button", { name: "How many day columns to show" }).click();
    await page.getByRole("menuitemradio", { name: "3 days" }).click();

    // Frozen on a Tuesday (support/fixtures.ts), so this is still the
    // leftmost day column after the resize.
    const column = page.getByRole("region", { name: "Tuesday" }).first();

    // 3 columns + 2 12px `gap-3` gaps fill the track exactly (the gap IS
    // the column separator since the Air pass — keep this in step with
    // DAY_GAP_PX in desktop-board.tsx). `expect.poll` rather than a single
    // `boundingBox()` read: the column carries `transition-all`
    // (board-column.tsx), so a read straight after the click can catch the
    // width mid-animation from the old 7-day size.
    const expectedWidth = (trackBox!.width - 2 * 12) / 3;
    await expect
      .poll(async () => (await column.boundingBox())?.width)
      .toBeGreaterThan(expectedWidth - 5);
    const columnBox = await column.boundingBox();
    expect(columnBox!.width).toBeLessThan(expectedWidth + 5);

    // More than 3 days are still rendered (DEFAULT_RENDERED_DAYS), so the
    // track now scrolls instead of shrinking to fit them all.
    const scrollWidth = await track.evaluate((el) => el.scrollWidth);
    const clientWidth = await track.evaluate((el) => el.clientWidth);
    expect(scrollWidth).toBeGreaterThan(clientWidth);
  });

  test("opens the todo sheet as a right-side panel", async ({ page }) => {
    await page.getByRole("region", { name: "Backlog" }).getByPlaceholder("Add a to-do").click();
    await page
      .getByRole("region", { name: "Backlog" })
      .getByPlaceholder("Add a to-do")
      .fill("Layout contract todo");
    await page.keyboard.press("Enter");

    // exact: true — the row's drag grip aria-label ("Drag to reschedule or
    // reorder <title>") also substring-matches the title alone.
    await page.getByRole("button", { name: "Layout contract todo", exact: true }).click();
    const sheet = page.locator('[data-slot="sheet-content"][data-side="right"]');
    await expect(sheet).toBeVisible();
  });
});
