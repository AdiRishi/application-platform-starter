import type { buildProcessor } from "./support/build-processor.ts";

declare module "vitest" {
  interface ProvidedContext {
    processorBundle: Awaited<ReturnType<typeof buildProcessor>>;
  }
}
export {};
