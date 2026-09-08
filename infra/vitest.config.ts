import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    sequence: { hooks: "list" },
    fileParallelism: false,
    testTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
    provide: { live: false },
  },
});
