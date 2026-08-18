import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../playwright.config";

/**
 * A vitest test *about* the Playwright config, not a Playwright test — it
 * runs in `npm test` (and so in CI's `verify` job), where it costs
 * milliseconds and fails long before anyone waits on the e2e job.
 *
 * It exists because of the footgun EI-187 introduced. Which projects a spec
 * runs under is now declared by `testMatch` in `playwright.config.ts`
 * (docs/E2E.md §8), which is what made the suite fast — but it means a spec
 * file that nobody adds to a `testMatch` list runs under **zero** projects
 * and passes silently. That is the exact failure mode docs/E2E.md §7 warns
 * about for `test.skip(callback)`: not an error, just tests that quietly
 * didn't run. Declaring coverage in the config traded a slow suite for a
 * quiet one, and this test buys back the loud failure.
 *
 * `e2e/*.test.ts` is this file's own pattern and is deliberately outside
 * every project's `testMatch`, so Playwright never picks it up.
 */
const E2E_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Every `*.spec.ts` sitting in `e2e/`, by bare filename. */
const specFiles = readdirSync(E2E_DIR)
  .filter((name) => name.endsWith(".spec.ts"))
  .sort();

/**
 * Every filename named by any project's `testMatch`, mapped back from its
 * `**‌/name.spec.ts` glob to just `name.spec.ts`.
 */
const matchedFiles = new Map<string, string[]>();
for (const project of config.projects ?? []) {
  const patterns = [project.testMatch ?? []].flat();
  for (const pattern of patterns) {
    const basename = String(pattern).replace(/^.*\//, "");
    matchedFiles.set(basename, [...(matchedFiles.get(basename) ?? []), project.name!]);
  }
}

describe("playwright.config.ts spec coverage", () => {
  it("declares at least one project for every spec file in e2e/", () => {
    const orphaned = specFiles.filter((file) => !matchedFiles.has(file));
    expect(
      orphaned,
      `${orphaned.join(", ")} would run under no project at all. Add each to the ` +
        `SPECS map and to the testMatch of every project that should run it ` +
        `(playwright.config.ts), then record the choice in docs/E2E.md §8.`,
    ).toEqual([]);
  });

  it("names only spec files that exist", () => {
    const dangling = [...matchedFiles.keys()].filter((file) => !specFiles.includes(file));
    expect(
      dangling,
      `testMatch names ${dangling.join(", ")}, which no longer exists in e2e/. ` +
        `A renamed or deleted spec silently stops running rather than failing.`,
    ).toEqual([]);
  });

  it("keeps every project non-empty", () => {
    const empty = (config.projects ?? [])
      .filter((project) => [project.testMatch ?? []].flat().length === 0)
      .map((project) => project.name);
    expect(
      empty,
      `${empty.join(", ")} has no testMatch, so it silently runs every spec — ` +
        `which is the 180-run behaviour EI-187 removed.`,
    ).toEqual([]);
  });
});
