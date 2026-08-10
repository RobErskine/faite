import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
    // wrangler-generated (`npm run cf-typegen`); machine-formatted, not ours
    // to fix lint warnings in.
    "cloudflare-env.d.ts",
    // drizzle-kit-generated (`npm run schema:generate`). Kept in the repo as
    // the record to diff a schema change against — never loaded at runtime,
    // since the DO migrates itself from `src/server/db/migrations.ts`.
    "drizzle/**",
  ]),
]);

export default eslintConfig;
