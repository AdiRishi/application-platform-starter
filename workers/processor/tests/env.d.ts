import type { ProcessorEnv } from "@repo/infra/worker-bindings";
import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env extends ProcessorEnv {
      TEST_MIGRATIONS: D1Migration[];
    }

    interface GlobalProps {
      durableNamespaces: "CsvProfileSession";
      mainModule: typeof import("../src/index.ts");
    }
  }
}

export {};
