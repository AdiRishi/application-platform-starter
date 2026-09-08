import * as Cloudflare from "alchemy/Cloudflare";
import * as SQL from "alchemy/SQL/D1";
import { Effect } from "effect";

import { profileSession } from "../../workers/processor/src/artifacts/profile-session.ts";
import type { DataPlane } from "./data-plane.ts";
import type { DeploymentConfig } from "./deployment-config.ts";
import type { Processor } from "./processor.ts";

export class CsvProfileSession extends Cloudflare.DurableObject<CsvProfileSession>()(
  "CsvProfileSession",
  profileSession,
) {}

export const processorBindings = Effect.fn("ApplicationPlatform.ProcessorBindings")(function* (
  data: DataPlane,
) {
  const artifacts = yield* Cloudflare.R2.ReadBucket(data.artifacts);
  const database = yield* Cloudflare.D1.QueryDatabase(data.database);
  const sessions = yield* CsvProfileSession;
  return { artifacts, database: SQL.D1Layer(database), sessions };
});

export const apiBindings = (
  data: DataPlane,
  environment: DeploymentConfig["environment"],
  processor: Effect.Success<typeof Processor>,
) => ({
  ARTIFACTS: data.artifacts,
  DB: data.database,
  ENVIRONMENT: environment,
  PROFILE_JOBS: data.profileJobs,
  PROCESSOR: processor,
});

export const websiteBindings = (
  environment: DeploymentConfig["environment"],
  api: Cloudflare.Worker,
) => ({
  API: Cloudflare.WorkerEntrypoint(api),
  ENVIRONMENT: environment,
});

export type ApiEnv = Cloudflare.InferEnv<ReturnType<typeof apiBindings>>;
export type WebsiteEnv = Cloudflare.InferEnv<ReturnType<typeof websiteBindings>>;
