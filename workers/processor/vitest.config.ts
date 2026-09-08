import { defineConfig } from "vitest/config";

import { buildProcessor } from "./tests/support/build-processor.ts";

export default defineConfig(async () => ({
  test: { provide: { processorBundle: await buildProcessor() }, testTimeout: 15_000 },
}));
