import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { workerCompatibility, workerObservability } from "./cloudflare-config.ts";
import type { DataPlane } from "./data-plane.ts";
import type { DeploymentConfig } from "./deployment-config.ts";
import { Processor } from "./processor.ts";
import { apiBindings } from "./worker-bindings.ts";

export const workerGraph = Effect.fn("ApplicationPlatform.WorkerGraph")(function* (
  config: DeploymentConfig,
  data: DataPlane,
) {
  const processor = yield* Processor;

  const api = yield* Cloudflare.Worker("ApiWorker", {
    main: "../workers/api/src/index.ts",
    compatibility: workerCompatibility,
    workersDev: false,
    crons: ["* * * * *"],
    observability: workerObservability,
    env: apiBindings(data, config.environment, processor),
  });

  return { api, processor };
});

export type Workers = Effect.Success<ReturnType<typeof workerGraph>>;
