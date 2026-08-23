import { resolve } from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { workerCompatibility } from "@repo/infra/cloudflare-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./src/index.ts",
      miniflare: {
        name: "application-platform-starter-api-test",
        bindings: {
          ENVIRONMENT: "test",
          TEST_MIGRATIONS: await readD1Migrations(resolve(import.meta.dirname, "../../migrations")),
        },
        compatibilityDate: workerCompatibility.date,
        compatibilityFlags: workerCompatibility.flags,
        d1Databases: ["DB"],
        queueProducers: ["PROFILE_JOBS"],
        r2Buckets: ["ARTIFACTS"],
        serviceBindings: {
          PROCESSOR: () => new Response("Processor is not used by these API integration tests."),
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./tests/setup.ts"],
  },
});
