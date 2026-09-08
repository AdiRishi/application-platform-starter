import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { defineConfig } from "vitest/config";

const envFile = new URL("./.env", import.meta.url);
if (existsSync(envFile)) loadEnvFile(envFile);

export default defineConfig({
  test: {
    testTimeout: 120_000,
    sequence: { hooks: "list" },
    provide: { live: true },
    include: ["tests/alchemy.run.integration.test.ts"],
  },
});
