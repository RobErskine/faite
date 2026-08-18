import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Plain Playwright test code, not React — `eslint-config-next`'s
    // react-hooks rules still apply here by default and false-positive on
    // Playwright's own fixture API, whose second callback parameter is
    // conventionally named `use` (e.g. `page: async ({ page }, use) => {...}`
    // in e2e/support/fixtures.ts): `react-hooks/rules-of-hooks` treats any
    // function literally named `use` as a hook call, regardless of context.
    files: ["e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated build output — linting it produces thousands of errors from
    // machine-generated code and would keep CI permanently red.
    ".next-static/**",
    ".open-next/**",
    ".wrangler/**",
    // Nested git worktrees (`.claude/worktrees/*`) are full checkouts of this
    // same repo. Without this, `npm run lint` walks into every in-flight
    // branch and reports its files as if they were ours — 200+ files and
    // thousands of problems that have nothing to do with the current tree.
    ".claude/**",
    // wrangler-generated (`npm run cf-typegen`); machine-formatted, not ours
    // to fix lint warnings in.
    "cloudflare-env.d.ts",
    // drizzle-kit-generated (`npm run schema:generate`). Kept in the repo as
    // the record to diff a schema change against — never loaded at runtime,
    // since the DO migrates itself from `src/server/db/migrations.ts`.
    "drizzle/**",
    // Tauri desktop shell (D0+): Rust crate, not part of the Next.js lint
    // surface. `target/` also embeds copies of the static export's JS as
    // Cargo build artifacts, which ESLint would otherwise try to parse as
    // machine-generated, gitignored source.
    "src-tauri/**",
  ]),
]);

export default eslintConfig;
