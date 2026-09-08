import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { projects: ["./vitest.ui.config.ts", "./vitest.worker.config.ts"] },
});
