import { defineConfig } from "vitest/config";

// Every package keeps its suite beside its source, and the root run covers all
// of them — a package whose tests only ever run from its own directory is a
// package the workspace stops checking.
export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
