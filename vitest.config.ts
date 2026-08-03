import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// No @vitejs/plugin-react here: it is only needed for Fast Refresh, and
// pulling it in makes plugin types resolve against a different copy of vite
// than vitest's own. Vitest's esbuild transform handles JSX via the automatic
// runtime already configured in tsconfig.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
