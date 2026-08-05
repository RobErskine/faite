import { defineConfig } from "drizzle-kit";

/**
 * Per-user Durable Object storage (P3) — todo/list/label/project/tab/settings
 * data plus the field-clock and version-counter tables. Separate from
 * `drizzle.config.ts` (D1 auth tables): different driver, different runtime
 * (`ctx.storage` inside the DO, not a D1 binding), different output folder.
 */
export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/server/db/user-schema.ts",
  out: "./drizzle/user",
});
