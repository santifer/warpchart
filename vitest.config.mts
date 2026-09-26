import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// One runner for both worlds: the app's TypeScript (with the "@/" alias) and the
// collector's dependency-free .mjs. Tests live next to the code they pin down.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "collector/**/*.test.mjs", "scripts/**/*.test.mjs"],
  },
});
