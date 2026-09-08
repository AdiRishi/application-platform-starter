import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { workerCompatibility } from "@repo/infra/cloudflare-config";
import { defineProject } from "vitest/config";

import { api } from "./tests/support/api.ts";

export default defineProject({
  plugins: [
    cloudflareTest({
      main: "./dist/server/worker.js",
      miniflare: {
        compatibilityDate: workerCompatibility.date,
        compatibilityFlags: workerCompatibility.flags,
        bindings: { ENVIRONMENT: "test" },
        serviceBindings: {
          API: async (request) =>
            api.handler(
              new Request(request.url, {
                method: request.method,
                headers: [...request.headers],
                body: await request.arrayBuffer(),
              }),
            ),
        },
      },
    }),
  ],
  test: {
    name: "worker",
    include: ["tests/**/*.integration.test.ts"],
    testTimeout: 30_000,
  },
});
