import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import { api } from "../../workers/api/src/index.ts";
import { workerCompatibility, workerObservability } from "./cloudflare-config.ts";
import { dataPlane } from "./data-plane.ts";
import { deploymentConfig } from "./deployment-config.ts";
import { apiBindings } from "./worker-bindings.ts";

export class Api extends Cloudflare.Worker<
  Api,
  Pick<
    Effect.Success<ReturnType<typeof api>>,
    | "fetch"
    | "getArtifact"
    | "listArtifacts"
    | "getProfileSource"
    | "startProfile"
    | "completeProfile"
    | "failProfile"
  >
>()("ApiWorker") {}

export default Api.make(
  {
    main: import.meta.url,
    compatibility: workerCompatibility,
    workersDev: false,
    observability: workerObservability,
  },
  Effect.gen(function* () {
    const config = yield* deploymentConfig();
    const data = yield* dataPlane;
    const bindings = yield* apiBindings(data);
    const runtime = yield* api(bindings, config.environment);
    yield* Cloudflare.Workers.cron("* * * * *", () => runtime.dispatch);
    return {
      getProfileSource: runtime.getProfileSource,
      startProfile: runtime.startProfile,
      completeProfile: runtime.completeProfile,
      failProfile: runtime.failProfile,
      fetch: runtime.fetch,
      getArtifact: runtime.getArtifact,
      listArtifacts: runtime.listArtifacts,
    };
  }).pipe(
    Effect.provide([
      Cloudflare.Workers.CronEventSourceLive,
      Cloudflare.R2.ReadWriteBucketBinding,
      Cloudflare.D1.QueryDatabaseBinding,
      Cloudflare.Queues.WriteQueueBinding,
    ]),
  ),
);
