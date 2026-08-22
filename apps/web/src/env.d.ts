import type { WebEnv } from "@repo/infra/worker-bindings";

declare global {
  namespace Cloudflare {
    interface Env extends WebEnv {}
  }
}

export {};
