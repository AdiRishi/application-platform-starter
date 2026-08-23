import { resolve } from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { workerCompatibility } from "@repo/infra/cloudflare-config";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(resolve(import.meta.dirname, "../../migrations"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        name: "application-platform-starter-api-test",
        bindings: { ENVIRONMENT: "test" },
        compatibilityDate: workerCompatibility.date,
        compatibilityFlags: workerCompatibility.flags,
        d1Databases: ["DB"],
        queueProducers: ["PROFILE_JOBS"],
        r2Buckets: ["ARTIFACTS"],
      },
    }),
  ],
  test: {
    provide: { migrations },
  },
});
