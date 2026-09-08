import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Alchemy registers fallback cleanup after our destroy hook. Run hooks in
    // registration order so destroy(Stack) can still use the local runtime.
    sequence: { hooks: "list" },
    fileParallelism: false,
    testTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.browser.test.ts"],
    provide: { live: false },
  },
});
