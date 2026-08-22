import { resolve } from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(resolve(import.meta.dirname, "../../migrations"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        name: "application-platform-starter-processor-test",
        bindings: {
          DEAD_LETTER_QUEUE_NAME: "profile-jobs-dlq",
          ENVIRONMENT: "test",
        },
        compatibilityDate: "2026-08-22",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        durableObjects: {
          PROFILE_SESSIONS: { className: "CsvProfileSession", useSQLite: true },
        },
        r2Buckets: ["ARTIFACTS"],
      },
    }),
  ],
  test: {
    provide: { migrations },
  },
});
