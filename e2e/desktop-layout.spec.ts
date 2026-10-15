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

    // Frozen on a Tuesday (support/fixtures.ts), so Today is still the
    // leftmost day column after the resize.
    const today = page.getByRole("region", { name: "Tuesday" }).first();
    const tomorrow = page.getByRole("region", { name: "Wednesday" }).first();
    const laterPage = page.getByRole("region", { name: "Friday" }).first();

    // EI-384: Today is 1.5x its neighbors (`--column-today-ratio`), and
    // Today + 2 neighbors + 2 12px `gap-3` gaps still fill the track exactly
    // (keep in step with DAY_GAP_PX in day-track-widths.ts). `expect.poll`
    // rather than a single `boundingBox()` read: the column carries
    // `transition-all` (board-column.tsx), so a read straight after the click
    // can catch the width mid-animation from the old 7-day size.
    const near = (trackBox!.width - 2 * 12) / 3.5;
    await expect
      .poll(async () => (await today.boundingBox())?.width)
      .toBeGreaterThan(1.5 * near - 5);
    const todayBox = await today.boundingBox();
    expect(todayBox!.width).toBeLessThan(1.5 * near + 5);
    const tomorrowBox = await tomorrow.boundingBox();
    expect(Math.abs(tomorrowBox!.width - near)).toBeLessThan(5);

    // Past Today's page every column is equal again: 3 of them fill the
    // track, exactly as before EI-384.
    const laterBox = await laterPage.boundingBox();
    expect(Math.abs(laterBox!.width - (trackBox!.width - 2 * 12) / 3)).toBeLessThan(5);

    // More than 3 days are still rendered (DEFAULT_RENDERED_DAYS), so the
    // track now scrolls instead of shrinking to fit them all.
    const scrollWidth = await track.evaluate((el) => el.scrollWidth);
    const clientWidth = await track.evaluate((el) => el.clientWidth);
    expect(scrollWidth).toBeGreaterThan(clientWidth);
  });

  /**
   * EI-384: Today gets room. At 1440 the floor binds (the track is 1174px and
   * seven 168px days need 1248), so Today is 252px and every other day keeps
   * the floor — and the range title ends at the last day actually shown
   * rather than counting the 10px of the next one.
   */
  test("gives Today 1.5x a day column in the default week, and titles what is shown", async ({
    page,
  }) => {
    const today = await page.getByRole("region", { name: "Tuesday" }).first().boundingBox();
    const tomorrow = await page.getByRole("region", { name: "Wednesday" }).first().boundingBox();
    const later = await page.getByRole("region", { name: "Saturday" }).first().boundingBox();
    expect(Math.abs(tomorrow!.width - 168)).toBeLessThan(1);
    expect(Math.abs(later!.width - 168)).toBeLessThan(1);
    expect(Math.abs(today!.width - 1.5 * 168)).toBeLessThan(1);

    // Today + five days; the sixth (Monday) shows 10px, so the title stops
    // at Sunday — five days after the frozen Tuesday.
    const title = await page.getByRole("heading", { level: 1 }).textContent();
    expect(title).toMatch(/^\w{3} \d{1,2} – \w{3} \d{1,2}$/);
    const track = page.locator(".column-track").filter({ has: page.locator("[data-day-column]") });
    const trackBox = await track.boundingBox();
    const sunday = await page.getByRole("region", { name: "Sunday" }).first().boundingBox();
    const monday = await page.getByRole("region", { name: "Monday" }).first().boundingBox();
    expect(sunday!.x + sunday!.width).toBeLessThanOrEqual(trackBox!.x + trackBox!.width + 1);
    expect(trackBox!.x + trackBox!.width - monday!.x).toBeLessThan(168 / 3);
    const sundayLabel = (await page
      .getByRole("region", { name: "Sunday" })
      .first()
      .getAttribute("aria-label"))!;
    expect(title!.endsWith(sundayLabel.split(", ").at(-1)!)).toBe(true);
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
