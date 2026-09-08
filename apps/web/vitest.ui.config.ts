import viteReact from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [viteReact()],
  test: {
    name: "ui",
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/**/*.integration.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
