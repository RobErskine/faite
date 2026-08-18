import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// No @vitejs/plugin-react here: it is only needed for Fast Refresh, and
// pulling it in makes plugin types resolve against a different copy of vite
// than vitest's own. Vitest's esbuild transform handles JSX via the automatic
// runtime already configured in tsconfig.
export default defineConfig({
  test: {
    environment: "node",
    // `e2e/**/*.test.ts` is not the Playwright suite — those are `*.spec.ts`
    // and Playwright runs them. It is for tests *about* the e2e setup that
    // want to fail in seconds during `verify` rather than minutes into the
    // e2e job; `e2e/config-coverage.test.ts` is the first (EI-187).
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "e2e/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
