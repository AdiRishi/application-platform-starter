import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { defineConfig } from "vitest/config";

const envFile = new URL("./.env", import.meta.url);
if (existsSync(envFile)) loadEnvFile(envFile);

export default defineConfig({
  test: {
    include: ["tests/**/*.live.test.ts"],
  },
});
