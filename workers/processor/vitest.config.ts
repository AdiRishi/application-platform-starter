import { resolve } from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { workerCompatibility } from "@repo/infra/cloudflare-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./src/index.ts",
      miniflare: {
        name: "application-platform-starter-processor-test",
        bindings: {
          DEAD_LETTER_QUEUE_NAME: "profile-jobs-dlq",
          ENVIRONMENT: "test",
          TEST_MIGRATIONS: await readD1Migrations(resolve(import.meta.dirname, "../../migrations")),
        },
        compatibilityDate: workerCompatibility.date,
        compatibilityFlags: workerCompatibility.flags,
        d1Databases: ["DB"],
        durableObjects: {
          PROFILE_SESSIONS: { className: "CsvProfileSession", useSQLite: true },
        },
        r2Buckets: ["ARTIFACTS"],
      },
    })),
  ],
  test: {
    setupFiles: ["./tests/setup.ts"],
  },
});
