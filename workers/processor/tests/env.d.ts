import type { ProcessorEnv } from "@repo/infra/worker-bindings";
import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env extends ProcessorEnv {}
  }
}

declare module "vitest" {
  export interface ProvidedContext {
    readonly migrations: ReadonlyArray<D1Migration>;
  }
}

export {};
