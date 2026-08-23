import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { workerCompatibility, workerObservability } from "./cloudflare-config.ts";
import type { DataPlane } from "./data-plane.ts";
import type { DeploymentConfig } from "./deployment-config.ts";
import { resourceNames } from "./resource-names.ts";
import { apiBindings, processorBindings } from "./worker-bindings.ts";

export const workerGraph = Effect.fn("ApplicationPlatform.WorkerGraph")(function* (
  config: DeploymentConfig,
  data: DataPlane,
) {
  const names = resourceNames(config.stage);
  const processor = yield* Cloudflare.Worker("ProcessorWorker", {
    name: names.workers.processor,
    main: "../workers/processor/src/index.ts",
    compatibility: workerCompatibility,
    workersDev: false,
    observability: workerObservability,
    env: processorBindings(data, config.environment),
  });

  const api = yield* Cloudflare.Worker("ApiWorker", {
    name: names.workers.api,
    main: "../workers/api/src/index.ts",
    compatibility: workerCompatibility,
    workersDev: false,
    observability: workerObservability,
    env: apiBindings(data, config.environment, processor),
  });

  yield* Cloudflare.Queues.Consumer("ProfileJobConsumer", {
    queueId: data.profileJobs.queueId,
    scriptName: processor.workerName,
    deadLetterQueue: data.deadLetters.queueName,
    settings: { batchSize: 1, maxRetries: 3 },
  });
  yield* Cloudflare.Queues.Consumer("ProfileDeadLetterConsumer", {
    queueId: data.deadLetters.queueId,
    scriptName: processor.workerName,
    settings: { batchSize: 1 },
  });

  return { api, processor };
});

export type Workers = Effect.Success<ReturnType<typeof workerGraph>>;
