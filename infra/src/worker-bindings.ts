import * as Cloudflare from "alchemy/Cloudflare";
import * as SQL from "alchemy/SQL/D1";
import { Effect } from "effect";

import type { Api } from "./api.ts";
import type { DataPlane } from "./data-plane.ts";
import type { DeploymentConfig } from "./deployment-config.ts";
import { Processor } from "./processor.ts";
import { CsvProfileSession } from "./profile-session.ts";

export const processorBindings = Effect.fn("ApplicationPlatform.ProcessorBindings")(function* (
  data: DataPlane,
) {
  const artifacts = yield* Cloudflare.R2.ReadBucket(data.artifacts);
  const database = yield* Cloudflare.D1.QueryDatabase(data.database);
  const sessions = yield* CsvProfileSession;
  return { artifacts, database: SQL.D1Layer(database), sessions };
});

export const apiBindings = Effect.fn("ApplicationPlatform.ApiBindings")(function* (
  data: DataPlane,
) {
  const artifacts = yield* Cloudflare.R2.ReadWriteBucket(data.artifacts);
  const database = yield* Cloudflare.D1.QueryDatabase(data.database);
  const jobs = yield* Cloudflare.Queues.WriteQueue(data.profileJobs);
  const processor = yield* Cloudflare.Workers.bindWorker(Processor);
  return { artifacts, database: SQL.D1Layer(database), jobs, processor };
});

export const websiteBindings = (
  environment: DeploymentConfig["environment"],
  api: Effect.Success<typeof Api>,
) => ({ API: api, ENVIRONMENT: environment });

export type WebsiteEnv = Cloudflare.InferEnv<ReturnType<typeof websiteBindings>>;
