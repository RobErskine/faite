# EI-323 runbook: History calendar

The decisions and the facts I checked in the code are on
[EI-323](https://linear.app/rob-erskine/issue/EI-323): see the Decisions section and the `## Handoff` comment. This file tracks only progress and findings.

## Progress

- [x] Status events record `listId` (client `setTodoStatus`, server `buildUpdateTodoEntry`, and both payload type copies)
- [x] `dayTints()` in `day-log.ts`: grouped by effective color, the most `done` events win, a tie goes to the most recent, and the list comes from the payload before the current list
- [x] Sheet: Month · Quarter · Year tabs, a rolling window that ends at the anchor month, full-width cells, the tint through `modifiersStyles`, and the aria-label ", mostly {list}"
- [x] Small fixes: Today is `outline`, and today's empty state says "yet"
- [x] Delete `.ai/ei-322-linear-notes.md`
- [x] Verify: the unit tests, TZ=UTC, the CI verify steps in order, `e2e:ci` (production server on port 3100), screenshots
- [ ] PR, CI green, squash merge, the deploy confirmed in Cloudflare, EI-323 notes, Done

## Findings

- react-day-picker 10: `modifiersStyles` puts an inline style on the day **cell** (`td`, `getStyleForModifiers`), and `classNames.day_button` reaches the button. So a per-day color is one modifier per color plus a `modifiersStyles` entry. No `DayButton` component override is needed. An override defined inline would get a new component type on each render and remount every button, which drops focus.
- A rolling window must not be clamped with `startMonth` = the log's first month. With `numberOfMonths: 3`, react-day-picker would push the window forward (Aug–Oct in place of Jul–Sep). Clamp at `historyStartMonth − (span − 1)` instead.
- Container queries, not viewport breakpoints: on a 1289px window the sheet is only ~490px inside. `@xl` (576px) stacked the quarter vertically on desktop; `@md` (448px) puts it side by side and still stacks a phone (~358px).
- The shared calendar cell has `min-w-(--cell-size)` = 28px. Seven of those (196px) are wider than one of three columns (~155px), so the months OVERLAPPED until Quarter and Year set `[--cell-size:--spacing(5)]`. It looked fine in the unit tests; only the screenshot showed it.
- Visual check: on a production build, I gave three lists colors directly in IndexedDB and used `page.clock` to finish to-dos on five different days. Every aria-label said the correct list, including a 2-vs-1 day. Screenshots at 1289×1143 and iPhone 13, Month/Quarter/Year.
- Known limit: on a phone, the newest month is at the BOTTOM of Year (two columns, oldest first), so you scroll past empty months first. This will matter less as the log fills. I did not reverse the order: a reversed quarter on desktop would read Sep | Aug | Jul.
- Local gate (`CI=1`, production server on port 3100): 137 passed, 1 failed. The failure is the known local-only `touch-smoke` swipe on phone-iphone (it also fails on clean `main` here, and is green in CI). All six CI verify steps pass in order: 2,901 unit tests, no OpenAPI drift.
