import type { WebsiteEnv } from "@repo/infra/worker-bindings";
import * as cf from "cloudflare:workers";

export const env = new Proxy({} as WebsiteEnv, {
  get(_, prop) {
    return cf.env[prop as keyof typeof cf.env];
  },
});
