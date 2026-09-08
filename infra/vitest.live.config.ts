import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { defineConfig } from "vitest/config";

const envFile = new URL("./.env", import.meta.url);
if (existsSync(envFile)) loadEnvFile(envFile);

export default defineConfig({
  test: {
    testTimeout: 120_000,
    // Alchemy registers fallback cleanup after our destroy hook. Run hooks in
    // registration order so destroy(Stack) runs before the harness closes.
    sequence: { hooks: "list" },
    provide: { live: true },
    include: ["tests/alchemy.run.integration.test.ts"],
  },
});
